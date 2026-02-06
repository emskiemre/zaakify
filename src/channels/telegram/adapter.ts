/**
 * Zaakify Telegram Channel Adapter
 *
 * Telegram bot integration via grammY. Supports:
 *   - Text messages, photos, documents, voice/audio
 *   - Reply threading
 *   - User allowlists
 *   - Typing indicators (sendChatAction)
 *   - Markdown formatting in responses
 */

import { Bot, Context } from "grammy";
import type {
  ChannelAdapter,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  ChannelUser,
  MessageAttachment,
  TelegramChannelConfig,
} from "../../types/index.js";
import { ChannelId, UserId, MessageId } from "../../types/index.js";
import { genMessageId } from "../../utils/ids.js";
import { getLogger } from "../../utils/logger.js";

const log = getLogger("telegram");

export class TelegramAdapter implements ChannelAdapter {
  readonly type: ChannelType = "telegram";
  readonly name = "Telegram";

  private bot: Bot | null = null;
  private config: TelegramChannelConfig;
  private connected = false;

  onMessage?: (message: InboundMessage) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info("Telegram adapter disabled in config");
      return;
    }

    log.info("Starting Telegram adapter...");

    this.bot = new Bot(this.config.botToken);

    // Handle text messages
    this.bot.on("message:text", (ctx) => this.handleTextMessage(ctx));

    // Handle photos
    this.bot.on("message:photo", (ctx) => this.handlePhotoMessage(ctx));

    // Handle documents
    this.bot.on("message:document", (ctx) => this.handleDocumentMessage(ctx));

    // Handle voice messages
    this.bot.on("message:voice", (ctx) => this.handleVoiceMessage(ctx));

    // Error handling
    this.bot.catch((err) => {
      log.error({ err: err.error }, "Telegram bot error");
      this.onError?.(err.error instanceof Error ? err.error : new Error(String(err.error)));
    });

    // Start polling
    this.bot.start({
      onStart: () => {
        this.connected = true;
        log.info("Telegram bot started polling");
        this.onConnected?.();
      },
    });
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      this.connected = false;
      log.info("Telegram adapter stopped");
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not initialized");

    const chatId = message.channelId;

    // Send text with Markdown
    if (message.content) {
      await this.bot.api.sendMessage(chatId, message.content, {
        parse_mode: "Markdown",
        reply_parameters: message.replyToId
          ? { message_id: Number(message.replyToId) }
          : undefined,
      });
    }

    // Send attachments
    for (const att of message.attachments) {
      if (att.type === "image" && (att.url || att.data)) {
        const source = att.url || att.data!;
        await this.bot.api.sendPhoto(chatId, source as string);
      } else if ((att.url || att.data) && att.filename) {
        const source = att.url || att.data!;
        await this.bot.api.sendDocument(chatId, source as string);
      }
    }
  }

  /**
   * Check if user is allowed.
   */
  private isUserAllowed(userId: string): boolean {
    if (!this.config.allowedUsers?.length) return true;
    return this.config.allowedUsers.includes(userId);
  }

  /**
   * Build ChannelUser from Telegram context.
   */
  private buildUser(ctx: Context): ChannelUser | null {
    const from = ctx.from;
    if (!from) return null;

    if (!this.isUserAllowed(String(from.id))) {
      log.warn({ userId: from.id }, "Telegram user not in allowlist");
      return null;
    }

    return {
      id: UserId(`telegram:${from.id}`),
      displayName: from.first_name + (from.last_name ? ` ${from.last_name}` : ""),
      channelType: "telegram",
      channelSpecificId: String(from.id),
      metadata: {
        username: from.username,
        languageCode: from.language_code,
      },
    };
  }

  private handleTextMessage(ctx: Context): void {
    const user = this.buildUser(ctx);
    if (!user) return;

    const message = ctx.message!;

    // Show typing
    ctx.replyWithChatAction("typing").catch(() => {});

    const inbound: InboundMessage = {
      id: genMessageId(),
      sessionId: "" as never,
      channelType: "telegram",
      channelId: ChannelId(String(message.chat.id)),
      user,
      content: message.text || "",
      attachments: [],
      replyToId: message.reply_to_message
        ? MessageId(String(message.reply_to_message.message_id))
        : undefined,
      timestamp: message.date * 1000,
      raw: message,
    };

    this.onMessage?.(inbound);
  }

  private handlePhotoMessage(ctx: Context): void {
    const user = this.buildUser(ctx);
    if (!user) return;

    const message = ctx.message!;
    const photos = message.photo || [];
    const largest = photos[photos.length - 1]; // Telegram sends multiple sizes

    ctx.replyWithChatAction("typing").catch(() => {});

    const attachments: MessageAttachment[] = largest
      ? [
          {
            type: "image",
            mimeType: "image/jpeg",
            filename: `photo_${largest.file_id}.jpg`,
            size: largest.file_size,
          },
        ]
      : [];

    const inbound: InboundMessage = {
      id: genMessageId(),
      sessionId: "" as never,
      channelType: "telegram",
      channelId: ChannelId(String(message.chat.id)),
      user,
      content: message.caption || "",
      attachments,
      timestamp: message.date * 1000,
      raw: message,
    };

    this.onMessage?.(inbound);
  }

  private handleDocumentMessage(ctx: Context): void {
    const user = this.buildUser(ctx);
    if (!user) return;

    const message = ctx.message!;
    const doc = message.document;

    ctx.replyWithChatAction("typing").catch(() => {});

    const attachments: MessageAttachment[] = doc
      ? [
          {
            type: "file",
            mimeType: doc.mime_type || "application/octet-stream",
            filename: doc.file_name || "document",
            size: doc.file_size,
          },
        ]
      : [];

    const inbound: InboundMessage = {
      id: genMessageId(),
      sessionId: "" as never,
      channelType: "telegram",
      channelId: ChannelId(String(message.chat.id)),
      user,
      content: message.caption || "",
      attachments,
      timestamp: message.date * 1000,
      raw: message,
    };

    this.onMessage?.(inbound);
  }

  private handleVoiceMessage(ctx: Context): void {
    const user = this.buildUser(ctx);
    if (!user) return;

    const message = ctx.message!;
    const voice = message.voice;

    ctx.replyWithChatAction("typing").catch(() => {});

    const attachments: MessageAttachment[] = voice
      ? [
          {
            type: "audio",
            mimeType: voice.mime_type || "audio/ogg",
            size: voice.file_size,
          },
        ]
      : [];

    const inbound: InboundMessage = {
      id: genMessageId(),
      sessionId: "" as never,
      channelType: "telegram",
      channelId: ChannelId(String(message.chat.id)),
      user,
      content: "",
      attachments,
      timestamp: message.date * 1000,
      raw: message,
    };

    this.onMessage?.(inbound);
  }
}
