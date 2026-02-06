/**
 * Zaakify ID Generation
 *
 * Compact, URL-safe, collision-resistant IDs using nanoid.
 * Prefixed for easy visual identification in logs/debug.
 */

import { nanoid } from "nanoid";
import {
  SessionId,
  ChannelId,
  UserId,
  MessageId,
  AgentId,
  ExtensionId,
  ToolId,
} from "../types/index.js";

export const genSessionId = (): SessionId => SessionId(`ses_${nanoid(16)}`);
export const genChannelId = (): ChannelId => ChannelId(`ch_${nanoid(12)}`);
export const genUserId = (): UserId => UserId(`usr_${nanoid(12)}`);
export const genMessageId = (): MessageId => MessageId(`msg_${nanoid(16)}`);
export const genAgentId = (): AgentId => AgentId(`agt_${nanoid(12)}`);
export const genExtensionId = (): ExtensionId => ExtensionId(`ext_${nanoid(12)}`);
export const genToolId = (): ToolId => ToolId(`tl_${nanoid(12)}`);
export const genCorrelationId = (): string => `cor_${nanoid(20)}`;
