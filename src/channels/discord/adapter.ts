/**
 * Zaakify Discord Channel Adapter
 *
 * Full Discord integration via discord.js. Supports:
 *   - Guild text channels and DMs
 *   - Message attachments (images, files)
 *   - Reply threading
 *   - Typing indicators
 *   - Guild/channel allowlists for security
 *   - Slash commands (/ask)
 *
 * Improvement over OpenClaw:
 *   - OpenClaw uses @buape/carbon (less mature) -- we use discord.js (battle-tested)
 *   - Process-isolation ready: this adapter can run as a standalone worker
 *   - Cleaner attachment handling with proper MIME detection
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  Message as DiscordMessage,
  TextChannel,
  DMChannel,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import type {
  ChannelAdapter,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  ChannelUser,
  MessageAttachment,
  DiscordChannelConfig,
} from "../../types/index.js";
import {
  ChannelId,
  UserId,
  MessageId,
} from "../../types/index.js";
import { genMessageId } from "../../utils/ids.js";
import { getLogger } from "../../utils/logger.js";
import { splitMessage, detectContentType } from "../message-utils.js";

const log = getLogger("discord");

export class DiscordAdapter implements ChannelAdapter {
  readonly type: ChannelType = "discord";
  readonly name = "Discord";

  private client: Client | null = null;
  private config: DiscordChannelConfig;
  private connected = false;

  // Callbacks set by the router
  onMessage?: (message: InboundMessage) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;

  constructor(config: DiscordChannelConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info("Discord adapter disabled in config");
      return;
    }

    log.info("Starting Discord adapter...");

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    // Register event handlers
    this.client.on(Events.ClientReady, (readyClient) => {
      this.connected = true;
      log.info({ user: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
        "Discord bot connected");
      this.onConnected?.();
      this.registerSlashCommands(readyClient.user.id);
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === "ask") {
        const question = interaction.options.getString("prompt", true);
        await interaction.deferReply();

        // Create a synthetic inbound message
        const inbound = this.buildInboundFromInteraction(
          interaction.user.id,
          interaction.user.username,
          interaction.channelId,
          question,
        );

        this.onMessage?.(inbound);

        // The response will be sent via handleOutbound -> editReply
        // Store the interaction for response routing
        this.pendingInteractions.set(inbound.id, interaction);
      }
    });

    this.client.on(Events.Error, (error) => {
      log.error({ err: error }, "Discord client error");
      this.onError?.(error);
    });

    this.client.on(Events.ShardDisconnect, () => {
      this.connected = false;
      this.onDisconnected?.();
    });

    this.client.on(Events.ShardReconnecting, () => {
      log.info("Discord reconnecting...");
    });

    await this.client.login(this.config.token);
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.connected = false;
      log.info("Discord adapter stopped");
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Store pending slash command interactions for async response
  private pendingInteractions: Map<MessageId, unknown> = new Map();

  /**
   * Send a message back to Discord.
   */
  async send(message: OutboundMessage): Promise<void> {
    if (!this.client) throw new Error("Discord client not initialized");

    const channel = await this.client.channels.fetch(message.channelId);

    if (!channel) {
      throw new Error(`Discord channel not found: ${message.channelId}`);
    }

    if (!(channel instanceof TextChannel) && !(channel instanceof DMChannel)) {
      throw new Error(`Channel ${message.channelId} is not a text channel`);
    }

    // Split long messages (Discord 2000 char limit)
    const chunks = splitMessage(message.content, 2000);

    for (const chunk of chunks) {
      const sendOpts: Record<string, unknown> = { content: chunk };

      // Reply to original message if specified
      if (message.replyToId) {
        sendOpts.reply = { messageReference: message.replyToId };
      }

      await channel.send(sendOpts as Parameters<typeof channel.send>[0]);
    }

    // Handle file attachments
    if (message.attachments.length > 0) {
      const files = message.attachments
        .filter((a) => a.data || a.url)
        .map((a) => ({
          attachment: a.data || a.url!,
          name: a.filename || "attachment",
        }));

      if (files.length > 0) {
        await channel.send({ files } as Parameters<typeof channel.send>[0]);
      }
    }
  }

  /**
   * Handle incoming Discord message.
   */
  private handleMessage(message: DiscordMessage): void {
    // Ignore bot messages (including our own)
    if (message.author.bot) return;

    // Guild allowlist check
    if (message.guildId && this.config.allowedGuilds?.length) {
      if (!this.config.allowedGuilds.includes(message.guildId)) return;
    }

    // Channel allowlist check
    if (this.config.allowedChannels?.length) {
      if (!this.config.allowedChannels.includes(message.channelId)) return;
    }

    // Check if the bot is mentioned or it's a DM
    const isMentioned = message.mentions.has(this.client!.user!.id);
    const isDM = !message.guildId;

    // Only respond to DMs or mentions (don't respond to every message)
    if (!isDM && !isMentioned) return;

    // Strip the mention from the content
    let content = message.content;
    if (isMentioned && this.client?.user) {
      content = content.replace(new RegExp(`<@!?${this.client.user.id}>`, "g"), "").trim();
    }

    if (!content && message.attachments.size === 0) return;

    // Build user
    const user: ChannelUser = {
      id: UserId(`discord:${message.author.id}`),
      displayName: message.author.displayName || message.author.username,
      channelType: "discord",
      channelSpecificId: message.author.id,
      avatarUrl: message.author.displayAvatarURL(),
      metadata: {
        guildId: message.guildId,
        guildName: message.guild?.name,
      },
    };

    // Build attachments
    const attachments: MessageAttachment[] = message.attachments.map((att) => ({
      type: detectContentType(att.contentType || ""),
      url: att.url,
      mimeType: att.contentType || "application/octet-stream",
      filename: att.name || undefined,
      size: att.size,
    }));

    const inbound: InboundMessage = {
      id: genMessageId(),
      sessionId: "" as never, // Set by session manager
      channelType: "discord",
      channelId: ChannelId(message.channelId),
      user,
      content,
      attachments,
      replyToId: message.reference?.messageId
        ? MessageId(message.reference.messageId)
        : undefined,
      timestamp: message.createdTimestamp,
      raw: message,
    };

    // Show typing indicator
    if (message.channel instanceof TextChannel || message.channel instanceof DMChannel) {
      message.channel.sendTyping().catch(() => {});
    }

    this.onMessage?.(inbound);
  }

  /**
   * Build inbound message from a slash command interaction.
   */
  private buildInboundFromInteraction(
    userId: string,
    username: string,
    channelId: string,
    content: string,
  ): InboundMessage {
    return {
      id: genMessageId(),
      sessionId: "" as never,
      channelType: "discord",
      channelId: ChannelId(channelId),
      user: {
        id: UserId(`discord:${userId}`),
        displayName: username,
        channelType: "discord",
        channelSpecificId: userId,
      },
      content,
      attachments: [],
      timestamp: Date.now(),
    };
  }

  /**
   * Register slash commands.
   */
  private async registerSlashCommands(clientId: string): Promise<void> {
    try {
      const rest = new REST({ version: "10" }).setToken(this.config.token);
      const commands = [
        new SlashCommandBuilder()
          .setName("ask")
          .setDescription("Ask Zaakify a question")
          .addStringOption((opt) =>
            opt.setName("prompt").setDescription("Your question").setRequired(true),
          )
          .toJSON(),
      ];

      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      log.info("Slash commands registered");
    } catch (err) {
      log.error({ err }, "Failed to register slash commands");
    }
  }

}
