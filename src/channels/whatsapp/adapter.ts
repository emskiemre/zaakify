/**
 * Zaakify WhatsApp Channel Adapter
 *
 * WhatsApp Web integration via Baileys. Supports:
 *   - Text messages
 *   - Image/document/audio messages
 *   - QR code pairing for authentication
 *   - Automatic reconnection
 *   - Session persistence
 *
 * Note: WhatsApp Web is unofficial. This uses the same library (Baileys)
 * as OpenClaw but with cleaner lifecycle management and error recovery.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { mkdirSync, existsSync } from "node:fs";
import type {
  ChannelAdapter,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  ChannelUser,
  MessageAttachment,
  WhatsAppChannelConfig,
} from "../../types/index.js";
import { ChannelId, UserId } from "../../types/index.js";
import { genMessageId } from "../../utils/ids.js";
import { getLogger } from "../../utils/logger.js";

const log = getLogger("whatsapp");

export class WhatsAppAdapter implements ChannelAdapter {
  readonly type: ChannelType = "whatsapp";
  readonly name = "WhatsApp";

  private socket: ReturnType<typeof makeWASocket> | null = null;
  private config: WhatsAppChannelConfig;
  private connected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;

  onMessage?: (message: InboundMessage) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;

  constructor(config: WhatsAppChannelConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info("WhatsApp adapter disabled in config");
      return;
    }

    log.info("Starting WhatsApp adapter...");
    await this.connect();
  }

  private async connect(): Promise<void> {
    // Ensure session data directory exists
    const sessionPath = this.config.sessionDataPath;
    if (!existsSync(sessionPath)) {
      mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    this.socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true, // Show QR in terminal for pairing
      logger: undefined, // Silence Baileys' verbose logging
      browser: ["Zaakify", "Desktop", "1.0.0"],
      connectTimeoutMs: 30_000,
    });

    // Save credentials on update
    this.socket.ev.on("creds.update", saveCreds);

    // Connection updates
    this.socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log.info("WhatsApp QR code displayed in terminal. Scan to connect.");
      }

      if (connection === "open") {
        this.connected = true;
        this.reconnectAttempts = 0;
        log.info("WhatsApp connected");
        this.onConnected?.();
      }

      if (connection === "close") {
        this.connected = false;
        this.onDisconnected?.();

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
          log.info(
            { attempt: this.reconnectAttempts, delay },
            "WhatsApp reconnecting...",
          );
          setTimeout(() => this.connect(), delay);
        } else {
          log.error(
            { statusCode },
            "WhatsApp disconnected permanently. Re-run onboarding to re-pair.",
          );
        }
      }
    });

    // Message handling
    this.socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        this.handleMessage(msg as unknown as Record<string, unknown>);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
      this.connected = false;
      log.info("WhatsApp adapter stopped");
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp socket not initialized");

    const jid = message.channelId; // WhatsApp JID

    if (message.content) {
      await this.socket.sendMessage(jid, { text: message.content });
    }

    // Send attachments
    for (const att of message.attachments) {
      if (att.type === "image" && (att.data || att.url)) {
        await this.socket.sendMessage(jid, {
          image: att.data || { url: att.url! },
          caption: att.filename,
        });
      } else if (att.data || att.url) {
        await this.socket.sendMessage(jid, {
          document: att.data || { url: att.url! },
          mimetype: att.mimeType,
          fileName: att.filename || "file",
        });
      }
    }
  }

  /**
   * Handle an incoming WhatsApp message.
   */
  private handleMessage(msg: Record<string, unknown>): void {
    // Skip status broadcasts and our own messages
    const key = msg.key as Record<string, unknown> | undefined;
    if (!key) return;
    if (key.fromMe) return;
    if ((key.remoteJid as string)?.endsWith("@broadcast")) return;

    const remoteJid = key.remoteJid as string;
    const participant = (key.participant as string) || remoteJid;
    const pushName = (msg.pushName as string) || "Unknown";

    // Extract message content
    const msgContent = msg.message as Record<string, unknown> | undefined;
    if (!msgContent) return;

    let textContent = "";
    const attachments: MessageAttachment[] = [];

    // Text message
    const conversation = msgContent.conversation as string | undefined;
    const extendedText = msgContent.extendedTextMessage as Record<string, unknown> | undefined;
    if (conversation) {
      textContent = conversation;
    } else if (extendedText) {
      textContent = (extendedText.text as string) || "";
    }

    // Image message
    const imageMessage = msgContent.imageMessage as Record<string, unknown> | undefined;
    if (imageMessage) {
      textContent = (imageMessage.caption as string) || textContent;
      attachments.push({
        type: "image",
        mimeType: (imageMessage.mimetype as string) || "image/jpeg",
        filename: "image.jpg",
      });
    }

    // Document message
    const docMessage = msgContent.documentMessage as Record<string, unknown> | undefined;
    if (docMessage) {
      attachments.push({
        type: "file",
        mimeType: (docMessage.mimetype as string) || "application/octet-stream",
        filename: (docMessage.fileName as string) || "document",
      });
    }

    // Audio message
    const audioMessage = msgContent.audioMessage as Record<string, unknown> | undefined;
    if (audioMessage) {
      attachments.push({
        type: "audio",
        mimeType: (audioMessage.mimetype as string) || "audio/ogg",
      });
    }

    if (!textContent && attachments.length === 0) return;

    const user: ChannelUser = {
      id: UserId(`whatsapp:${participant}`),
      displayName: pushName,
      channelType: "whatsapp",
      channelSpecificId: participant,
    };

    const inbound: InboundMessage = {
      id: genMessageId(),
      sessionId: "" as never,
      channelType: "whatsapp",
      channelId: ChannelId(remoteJid),
      user,
      content: textContent,
      attachments,
      timestamp: ((msg.messageTimestamp as number) || Math.floor(Date.now() / 1000)) * 1000,
      raw: msg,
    };

    this.onMessage?.(inbound);
  }
}
