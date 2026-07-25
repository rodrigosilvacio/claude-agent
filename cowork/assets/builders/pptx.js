// Cowork — monta um .pptx real a partir do spec retornado pela edge function
// (docType "presentation"), usando pptxgenjs no browser.
import pptxgen from "https://esm.sh/pptxgenjs@3.12.0";

const TEXT_COLOR = "333333";

export async function buildPresentationBlob(spec) {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  const primaryColor = (spec.theme?.primaryColor || "1F4E78").replace(/^#/, "");

  for (const slide of spec.slides || []) {
    const s = pptx.addSlide();

    switch (slide.layout) {
      case "title":
        s.background = { color: primaryColor };
        s.addText(slide.title || "", {
          x: 0.5, y: 2.0, w: "90%", h: 1.2, fontSize: 40, bold: true, color: "FFFFFF", align: "center",
        });
        if (slide.subtitle) {
          s.addText(slide.subtitle, {
            x: 0.5, y: 3.2, w: "90%", h: 0.8, fontSize: 20, color: "F2F2F2", align: "center",
          });
        }
        break;

      case "section_header":
        s.background = { color: primaryColor };
        s.addText(slide.title || "", {
          x: 0.5, y: 2.2, w: "90%", h: 1.2, fontSize: 34, bold: true, color: "FFFFFF", align: "center",
        });
        break;

      case "closing":
        s.background = { color: primaryColor };
        s.addText(slide.title || "Obrigado", {
          x: 0.5, y: 2.0, w: "90%", h: 1.0, fontSize: 36, bold: true, color: "FFFFFF", align: "center",
        });
        if (slide.subtitle) {
          s.addText(slide.subtitle, {
            x: 0.5, y: 3.0, w: "90%", h: 0.8, fontSize: 18, color: "F2F2F2", align: "center",
          });
        }
        break;

      case "bullets":
        addHeader(s, slide.title, primaryColor, pptx);
        s.addText(bulletItems(slide.bullets), {
          x: 0.6, y: 1.5, w: "88%", h: 3.9, fontSize: 18, color: TEXT_COLOR, valign: "top",
        });
        break;

      case "two_column":
        addHeader(s, slide.title, primaryColor, pptx);
        s.addText(bulletItems(slide.leftBullets), {
          x: 0.6, y: 1.5, w: "42%", h: 3.9, fontSize: 16, color: TEXT_COLOR, valign: "top",
        });
        s.addText(bulletItems(slide.rightBullets), {
          x: 5.2, y: 1.5, w: "42%", h: 3.9, fontSize: 16, color: TEXT_COLOR, valign: "top",
        });
        break;

      case "title_content":
      default:
        addHeader(s, slide.title, primaryColor, pptx);
        s.addText(slide.body || "", {
          x: 0.6, y: 1.5, w: "88%", h: 3.9, fontSize: 18, color: TEXT_COLOR, valign: "top",
        });
        break;
    }

    if (slide.notes) {
      s.addNotes(slide.notes);
    }
  }

  return pptx.write({ outputType: "blob" });
}

function bulletItems(items) {
  return (items || []).map((text) => ({ text, options: { bullet: true, breakLine: true } }));
}

function addHeader(slide, title, primaryColor, pptx) {
  slide.addText(title || "", { x: 0.5, y: 0.35, w: "90%", h: 0.8, fontSize: 28, bold: true, color: primaryColor });
  slide.addShape(pptx.ShapeType.line, { x: 0.5, y: 1.15, w: 9.0, h: 0, line: { color: primaryColor, width: 1.5 } });
}
