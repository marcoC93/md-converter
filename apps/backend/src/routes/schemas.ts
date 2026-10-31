import {
  CONVERSION_MODES,
  DOCUMENT_FORMATS,
  IMAGE_MODES,
  type ConversionOptions,
} from '@md-converter/shared';
import { z } from 'zod';

export const jobParamsSchema = z.object({ jobId: z.uuid() });
export const fileParamsSchema = z.object({ jobId: z.uuid(), fileId: z.uuid() });
export const diagnosticsQuerySchema = z.object({ refresh: z.enum(['true', 'false']).optional() });

/** Schema delle opzioni di conversione; le lingue OCR sono limitate a quelle consentite. */
export function conversionOptionsSchema(allowedOcrLanguages: readonly string[]) {
  return z
    .object({
      outputFormat: z.enum(DOCUMENT_FORMATS),
      mode: z.enum(CONVERSION_MODES),
      imageMode: z.enum(IMAGE_MODES),
      ocr: z
        .object({
          enabled: z.boolean(),
          languages: z
            .array(
              z
                .string()
                .refine((code) => allowedOcrLanguages.includes(code), 'lingua non consentita'),
            )
            .min(1)
            .max(5)
            .refine((codes) => new Set(codes).size === codes.length, 'lingue duplicate'),
          force: z.boolean(),
        })
        .strict(),
    })
    .strict() satisfies z.ZodType<ConversionOptions>;
}
