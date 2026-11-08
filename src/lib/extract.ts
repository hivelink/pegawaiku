/**
 * Ekstraksi teks dari dokumen yang diunggah ke Drive: PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx/.csv), teks.
 * Dipakai oleh tool read_drive_file agar agent bisa membaca bahan yang diberikan user.
 */
import JSZip from "jszip";

export type Extracted = { text: string; pages?: number; note?: string };

function decodeXmlEntities(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export async function extractText(buf: Buffer, mime: string, filename: string): Promise<Extracted> {
  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (ext === "pdf" || mime === "application/pdf") {
    const { extractText: pdfText } = await import("unpdf");
    const r = await pdfText(new Uint8Array(buf), { mergePages: false });
    const pages = (r.text as string[]).map((t, i) => `## Halaman ${i + 1}\n${t.trim()}`);
    const text = pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    return { text, pages: r.totalPages, note: text.replace(/## Halaman \d+/g, "").trim().length < 50 ? "PDF ini tampaknya hasil scan (tanpa lapisan teks); perlu OCR." : undefined };
  }

  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ buffer: buf });
    return { text: r.value.trim() };
  }

  if (ext === "pptx" || mime.includes("presentationml")) {
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const parts: string[] = [];
    for (const name of slideFiles) {
      const xml = await zip.file(name)!.async("string");
      const n = name.match(/slide(\d+)\.xml/)![1];
      // gabungkan run teks per paragraf <a:p>
      const paras = Array.from(xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)).map((m) => Array.from(m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((t) => decodeXmlEntities(t[1])).join("")).filter((p) => p.trim());
      // catatan pembicara
      const notesName = `ppt/notesSlides/notesSlide${n}.xml`;
      let notes = "";
      if (zip.file(notesName)) {
        const nx = await zip.file(notesName)!.async("string");
        notes = Array.from(nx.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((t) => decodeXmlEntities(t[1])).join(" ").trim();
      }
      // tabel ditandai
      const hasTable = /<a:tbl>/.test(xml);
      const hasChart = /<c:chart/.test(xml) || /graphicFrame/.test(xml) && /chart/.test(xml);
      parts.push(`## Slide ${n}\n${paras.join("\n")}${hasTable ? "\n[berisi tabel]" : ""}${hasChart ? "\n[berisi grafik — data tidak terbaca sebagai teks]" : ""}${notes ? `\n(Catatan: ${notes})` : ""}`);
    }
    return { text: parts.join("\n\n"), pages: slideFiles.length };
  }

  if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const parts = wb.SheetNames.map((sn) => `## Sheet ${sn}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn]).trim()}`);
    return { text: parts.join("\n\n"), pages: wb.SheetNames.length };
  }

  if (ext === "csv" || ext === "txt" || ext === "md" || ext === "json" || ext === "html" || mime.startsWith("text/") || mime.includes("json")) {
    let t = buf.toString("utf8");
    if (ext === "html" || mime.includes("html")) t = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ");
    return { text: t.trim() };
  }

  return { text: "", note: `Format ${ext || mime} belum didukung untuk dibaca. Didukung: PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, HTML.` };
}
