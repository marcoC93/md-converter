// Genera i documenti di prova in tests/fixtures/files/.
// Tutto il contenuto è inventato: nessun dato reale o personale.
// Uso: pnpm fixtures   (non richiede Pandoc, LibreOffice o altri strumenti esterni)
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';

// yazl è una dipendenza del backend: la risolviamo da lì per non aggiungerla alla radice.
const require = createRequire(new URL('../../../apps/backend/package.json', import.meta.url));
const yazl = require('yazl');

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'files');
mkdirSync(outDir, { recursive: true });

// ---------- PNG minimale (senza librerie) ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Crea un PNG RGB a partire da una funzione (x, y) => [r, g, b]. */
function createPng(width, height, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit per canale
  header[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filtro "none"
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const gradient = (x, y) => [x * 4, y * 5, 160];
const bluePng = createPng(64, 48, gradient);
const orangePng = createPng(40, 40, (x, y) => [240, 120 + x, 40 + y]);

// ---------- Markdown ----------

const simpleMarkdown = `# Documento di prova

Questo è un documento **Markdown** di esempio, creato per i test automatici.
Contiene caratteri accentati: àèéìòù.

## Elenco puntato

- primo elemento
- secondo elemento con un [collegamento](https://example.org)
- terzo elemento

## Tabella

| Colonna A | Colonna B |
| --------- | --------- |
| uno       | due       |
| tre       | quattro   |

## Nota

Testo con una nota a piè di pagina.[^1]

[^1]: Questa è la nota.
`;
writeFileSync(join(outDir, 'simple.md'), simpleMarkdown);

const embeddedImageMarkdown = `# Immagine incorporata

![Quadrato arancione](data:image/png;base64,${orangePng.toString('base64')})

Testo dopo l'immagine.
`;
writeFileSync(join(outDir, 'embedded-image.md'), embeddedImageMarkdown);

// ---------- Pacchetto Markdown (.zip con immagini) ----------

function writeZip(fileName, entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, content] of entries) {
      zip.addBuffer(Buffer.from(content), name, { mtime: new Date('2026-01-01T00:00:00Z') });
    }
    zip.end();
    const stream = createWriteStream(join(outDir, fileName));
    zip.outputStream.pipe(stream).on('close', resolve).on('error', reject);
  });
}

const bundleMarkdown = `# Documento con immagini

Prima immagine, salvata nella cartella del pacchetto:

![Gradiente blu](images/gradiente.png "Figura 1")

Seconda immagine:

![Quadrato arancione](images/quadrato.png)

Questa immagine remota non viene scaricata (privacy):

![Remota](https://example.org/immagine.png)
`;
await writeZip('with-images.zip', [
  ['documento.md', bundleMarkdown],
  ['images/gradiente.png', bluePng],
  ['images/quadrato.png', orangePng],
]);

// ---------- DOCX minimale ----------

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const paragraph = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const imageParagraph = `<w:p><w:r><w:drawing><wp:inline>
<wp:extent cx="609600" cy="457200"/><wp:docPr id="1" name="Immagine 1" descr="Gradiente blu di prova"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
<pic:nvPicPr><pic:cNvPr id="1" name="gradiente.png" descr="Gradiente blu di prova"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rIdImage1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="609600" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const tableCell = (text) =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
const table = `<w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/></w:tblPr>
<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>
<w:tr>${tableCell('Prodotto')}${tableCell('Quantità')}</w:tr>
<w:tr>${tableCell('Mele')}${tableCell('3')}</w:tr>
<w:tr>${tableCell('Pere')}${tableCell('5')}</w:tr></w:tbl>`;

const hyperlinkParagraph = `<w:p><w:r><w:t xml:space="preserve">Visita </w:t></w:r><w:hyperlink r:id="rIdLink1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>il sito di esempio</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>
${paragraph('Relazione di prova', 'Heading1')}
${paragraph('Questo documento Word è stato generato automaticamente per i test. Contiene testo accentato: perché, città, così.')}
${paragraph('Sezione con immagine', 'Heading2')}
${imageParagraph}
${paragraph('Figura 1: gradiente blu', 'Caption')}
${paragraph('Sezione con tabella', 'Heading2')}
${table}
${hyperlinkParagraph}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

const style = (id, name, size) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
${style('Heading1', 'heading 1', 36)}
${style('Heading2', 'heading 2', 28)}
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/gradiente.png"/>
<Relationship Id="rIdLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/" TargetMode="External"/>
</Relationships>`;

await writeZip('simple.docx', [
  ['[Content_Types].xml', contentTypesXml],
  ['_rels/.rels', rootRelsXml],
  ['word/document.xml', documentXml],
  ['word/styles.xml', stylesXml],
  ['word/_rels/document.xml.rels', documentRelsXml],
  ['word/media/gradiente.png', bluePng],
]);

// ---------- PDF scritto a mano ----------

/** Converte testo Unicode in una stringa PDF con codifica WinAnsi (caratteri latini). */
function pdfString(text) {
  const winAnsi = { '•': 0x95, '–': 0x96, '’': 0x92 };
  let result = '(';
  for (const char of text) {
    const code = winAnsi[char] ?? char.codePointAt(0);
    if (char === '(' || char === ')' || char === '\\') result += '\\' + char;
    else if (code < 32 || code > 126) result += '\\' + code.toString(8).padStart(3, '0');
    else result += char;
  }
  return result + ')';
}

/**
 * Costruisce un PDF a partire da una lista di oggetti (stringhe o { dict, stream }).
 * Calcola gli offset della tabella xref, che i lettori PDF usano per trovare gli oggetti.
 */
function buildPdf(objects) {
  const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    let body;
    if (typeof object === 'string') {
      body = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'latin1');
    } else {
      const head = Buffer.from(
        `${index + 1} 0 obj\n<< ${object.dict} /Length ${object.stream.length} >>\nstream\n`,
        'latin1',
      );
      body = Buffer.concat([head, object.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    }
    chunks.push(body);
    length += body.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
  for (const offset of offsets) xref.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  xref.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
  );
  chunks.push(Buffer.from(xref.join(''), 'latin1'));
  return Buffer.concat(chunks);
}

function rawRgb(width, height, pixel) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(pixel(x, y), (y * width + x) * 3);
    }
  }
  return data;
}

const textLine = (font, size, x, y, text) =>
  `BT /${font} ${size} Tf ${x} ${y} Td ${pdfString(text)} Tj ET`;

function textPdf() {
  const header = (page) => [
    textLine('F1', 9, 72, 805, 'Documento di prova – uso interno fittizio'),
    textLine('F1', 9, 290, 30, `Pagina ${page}`),
  ];
  const page1 = [
    ...header(1),
    textLine('F2', 24, 72, 740, 'Rapporto di esempio'),
    textLine('F1', 11, 72, 705, 'Questo PDF è stato generato da uno script per verificare'),
    textLine('F1', 11, 72, 691, 'l’estrazione del testo. Le righe vicine formano un paragrafo.'),
    textLine('F2', 16, 72, 655, 'Obiettivi'),
    textLine('F1', 11, 72, 630, '• estrarre i titoli'),
    textLine('F1', 11, 72, 614, '• riconoscere gli elenchi'),
    textLine('F1', 11, 72, 598, '• conservare i collegamenti'),
    textLine('F1', 11, 72, 570, 'Sito di riferimento: https://example.org'),
    'q 128 0 0 96 72 440 cm /Im1 Do Q',
    textLine('F1', 10, 72, 425, 'Figura 1: gradiente di prova'),
  ];
  const page2 = [
    ...header(2),
    textLine('F2', 16, 72, 740, 'Dettagli'),
    textLine('F1', 11, 72, 715, 'Secondo paragrafo di prova, su una nuova pagina.'),
    textLine('F1', 11, 72, 701, 'Contiene una parola divisa con tratti-'),
    textLine('F1', 11, 72, 687, 'no alla fine della riga.'),
  ];
  const page3 = [
    ...header(3),
    textLine('F2', 16, 72, 740, 'Conclusioni'),
    textLine('F1', 11, 72, 715, '1. primo punto numerato'),
    textLine('F1', 11, 72, 699, '2. secondo punto numerato'),
  ];
  const image = rawRgb(64, 48, gradient);
  const font = (name) =>
    `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  const resources = '<< /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >>';
  const content = (lines) => ({ dict: '', stream: Buffer.from(lines.join('\n'), 'latin1') });
  const pageObject = (contentRef, extra = '') =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources ${resources} /Contents ${contentRef} 0 R ${extra}>>`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R /Lang (it-IT) >>',
    '<< /Type /Pages /Kids [6 0 R 8 0 R 10 0 R] /Count 3 >>',
    font('Helvetica'),
    font('Helvetica-Bold'),
    {
      dict: '/Type /XObject /Subtype /Image /Width 64 /Height 48 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode',
      stream: deflateSync(image),
    },
    pageObject(7, '/Annots [12 0 R] '),
    content(page1),
    pageObject(9),
    content(page2),
    pageObject(11),
    content(page3),
    '<< /Type /Annot /Subtype /Link /Rect [170 566 290 582] /Border [0 0 0] /A << /S /URI /URI (https://example.org/) >> >>',
  ]);
}

writeFileSync(join(outDir, 'text.pdf'), textPdf());

// ---------- PDF "scansionato": solo un'immagine con testo disegnato a pixel ----------

// Font bitmap 5x7 per le sole lettere necessarie.
const GLYPHS = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function scannedPdf() {
  const lines = ['SCANSIONE', 'DI PROVA'];
  const scale = 8;
  const width = 600;
  const height = 200;
  const pixels = Buffer.alloc(width * height * 3, 255);
  lines.forEach((line, row) => {
    [...line].forEach((char, column) => {
      const glyph = GLYPHS[char];
      glyph.forEach((bits, gy) => {
        [...bits].forEach((bit, gx) => {
          if (bit !== '1') return;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const x = 30 + column * 6 * scale + gx * scale + dx;
              const y = 30 + row * 9 * scale + gy * scale + dy;
              if (x < width && y < height)
                pixels.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
            }
          }
        });
      });
    });
  });
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    {
      dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
      stream: deflateSync(pixels),
    },
    { dict: '', stream: Buffer.from('q 500 0 0 167 48 600 cm /Im1 Do Q', 'latin1') },
  ]);
}

writeFileSync(join(outDir, 'scanned.pdf'), scannedPdf());

// ---------- File non validi per i test di errore ----------

writeFileSync(
  join(outDir, 'fake.pdf'),
  'Questo non è un PDF, solo testo con estensione sbagliata.\n',
);

console.log(`Fixture generate in ${outDir}`);
