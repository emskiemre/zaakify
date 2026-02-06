/**
 * Zaakify Media Pipeline
 *
 * Handles image processing, resizing, format conversion,
 * and attachment preparation for channel adapters.
 *
 * Uses sharp for image processing -- zero-copy, fast.
 */

import sharp from "sharp";
import { getLogger } from "../utils/logger.js";

const log = getLogger("media");

export interface ProcessedImage {
  data: Buffer;
  format: string;
  width: number;
  height: number;
  size: number;
}

export class MediaPipeline {
  /**
   * Resize an image to fit within max dimensions while preserving aspect ratio.
   */
  async resizeImage(
    input: Buffer | string,
    maxWidth = 1280,
    maxHeight = 1280,
  ): Promise<ProcessedImage> {
    const image = sharp(input);
    const metadata = await image.metadata();

    const result = await image
      .resize(maxWidth, maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });

    log.debug(
      {
        original: `${metadata.width}x${metadata.height}`,
        resized: `${result.info.width}x${result.info.height}`,
        size: result.info.size,
      },
      "Image resized",
    );

    return {
      data: result.data,
      format: "jpeg",
      width: result.info.width,
      height: result.info.height,
      size: result.info.size,
    };
  }

  /**
   * Convert an image to a specific format.
   */
  async convertImage(
    input: Buffer | string,
    format: "jpeg" | "png" | "webp" = "jpeg",
  ): Promise<Buffer> {
    return sharp(input).toFormat(format).toBuffer();
  }

  /**
   * Generate a thumbnail.
   */
  async generateThumbnail(
    input: Buffer | string,
    size = 200,
  ): Promise<Buffer> {
    return sharp(input)
      .resize(size, size, { fit: "cover" })
      .jpeg({ quality: 70 })
      .toBuffer();
  }

  /**
   * Get image metadata without processing.
   */
  async getMetadata(
    input: Buffer | string,
  ): Promise<{ width: number; height: number; format: string; size: number }> {
    const metadata = await sharp(input).metadata();
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || "unknown",
      size: metadata.size || 0,
    };
  }

  /**
   * Check if a buffer is a valid image.
   */
  async isValidImage(input: Buffer): Promise<boolean> {
    try {
      await sharp(input).metadata();
      return true;
    } catch {
      return false;
    }
  }
}
