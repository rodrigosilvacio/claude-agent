// Cowork — monta um .docx real a partir do spec retornado pela edge function
// (docType "document"), usando a lib "docx" (dolanmiu/docx), que roda direto
// no browser e produz um arquivo Word de verdade (títulos, listas, tabelas).
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  LevelFormat,
  AlignmentType,
  PageBreak,
} from "https://esm.sh/docx@9.0.2";

const HEADING_MAP = {
  heading1: HeadingLevel.HEADING_1,
  heading2: HeadingLevel.HEADING_2,
  heading3: HeadingLevel.HEADING_3,
};

const NUMBERED_LIST_REFERENCE = "cowork-numbered-list";

export async function buildDocumentBlob(spec) {
  const children = [];

  for (const section of spec.sections || []) {
    switch (section.type) {
      case "heading1":
      case "heading2":
      case "heading3":
        children.push(new Paragraph({ text: section.text || "", heading: HEADING_MAP[section.type] }));
        break;
      case "paragraph":
        children.push(new Paragraph({ children: [new TextRun(section.text || "")] }));
        break;
      case "bullet_list":
        for (const item of section.items || []) {
          children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
        }
        break;
      case "numbered_list":
        for (const item of section.items || []) {
          children.push(
            new Paragraph({ text: item, numbering: { reference: NUMBERED_LIST_REFERENCE, level: 0 } }),
          );
        }
        break;
      case "table":
        if (section.table) children.push(buildTable(section.table));
        break;
      case "page_break":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      default:
        break;
    }
  }

  const doc = new Document({
    title: spec.title,
    numbering: {
      config: [
        {
          reference: NUMBERED_LIST_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        children: [new Paragraph({ text: spec.title || "", heading: HeadingLevel.TITLE }), ...children],
      },
    ],
  });

  return Packer.toBlob(doc);
}

function buildTable(table) {
  const headers = table.headers || [];
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (header) =>
        new TableCell({
          width: { size: 100 / Math.max(1, headers.length), type: WidthType.PERCENTAGE },
          shading: { fill: "1F4E78" },
          children: [new Paragraph({ children: [new TextRun({ text: header, bold: true, color: "FFFFFF" })] })],
        }),
    ),
  });

  const bodyRows = (table.rows || []).map(
    (row) =>
      new TableRow({
        children: row.map((cell) => new TableCell({ children: [new Paragraph(String(cell ?? ""))] })),
      }),
  );

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] });
}
