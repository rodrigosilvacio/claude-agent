// Cowork — monta um .xlsx real a partir do spec retornado pela edge function
// (docType "spreadsheet"). Usa ExcelJS em vez do SheetJS community edition
// porque este precisa de estilo de verdade (cor/negrito no cabeçalho), que o
// SheetJS só libera na versão paga.
import ExcelJS from "https://esm.sh/exceljs@4.4.0";

export async function buildSpreadsheetBlob(spec) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Cowork";
  workbook.created = new Date();

  for (const sheetSpec of spec.sheets || []) {
    const sheet = workbook.addWorksheet(sanitizeSheetName(sheetSpec.name));
    const columns = sheetSpec.columns || [];

    sheet.columns = columns.map((col) => ({
      header: col.header,
      width: col.width || Math.max(12, Math.min(40, (col.header || "").length + 6)),
    }));

    if (columns.length > 0) {
      const fillColor = sheetSpec.headerStyle?.fillColor || "1F4E78";
      const fontColor = sheetSpec.headerStyle?.fontColor || "FFFFFF";
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: sheetSpec.headerStyle?.bold !== false, color: { argb: `FF${fontColor}` } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fillColor}` } };
        cell.alignment = { vertical: "middle" };
      });
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    }

    for (const row of sheetSpec.rows || []) {
      sheet.addRow(row);
    }
  }

  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet("Planilha");
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function sanitizeSheetName(name) {
  const cleaned = String(name || "Planilha").replace(/[\\/*?:[\]]/g, " ").trim();
  return cleaned.slice(0, 31) || "Planilha";
}
