import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WarningCode } from '@md-converter/shared';
import { writeZipFile } from '../files/zip-writer.js';
import { finalizeMarkdownImages, type ExtractedImage } from './markdown-images.js';
import type { PipelineContext, PipelineResult } from './pipeline-types.js';

/**
 * Scrive il risultato Markdown. Con immagini separate produce uno ZIP:
 *   nome.zip
 *   ├── nome.md
 *   └── images/image-001.png
 */
export async function writeMarkdownResult(
  context: PipelineContext,
  markdown: string,
  images: readonly ExtractedImage[],
  warnings: readonly WarningCode[],
): Promise<PipelineResult> {
  const finalized = await finalizeMarkdownImages(
    markdown,
    images,
    context.options.imageMode,
    context.limits.maxEmbeddedImagesBytes,
  );
  const allWarnings = [...new Set([...warnings, ...finalized.warnings])];
  const markdownName = `${context.outputBaseName}.md`;

  if (finalized.imageFiles.length === 0) {
    const outputPath = path.join(context.outputDir, 'result.md');
    await writeFile(outputPath, finalized.markdown, 'utf8');
    return { outputPath, fileName: markdownName, isArchive: false, warnings: allWarnings };
  }

  const outputPath = path.join(context.outputDir, 'result.zip');
  await writeZipFile(outputPath, [
    { archivePath: markdownName, content: finalized.markdown },
    ...finalized.imageFiles.map((image) => ({
      archivePath: image.archivePath,
      filePath: image.sourcePath,
    })),
  ]);
  return {
    outputPath,
    fileName: `${context.outputBaseName}.zip`,
    isArchive: true,
    warnings: allWarnings,
  };
}
