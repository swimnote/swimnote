import crypto from "node:crypto";

// Pinned, unsigned EDB PostgreSQL 16.15-1 executables only. No vendor archive is modified.
export const originals = Object.freeze({
  "initdb.exe": "98b243b81a86747112bc1d314bcc5775300623b91e4e243d71d945e3f857ea5a",
  "postgres.exe": "8192a1b2e02f9546b4fc775519c5ca719f2bfa1d6a4a7ac6f3258c5e4da39e5d",
});
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const addition = '<application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>' +
  '<activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>' +
  '</windowsSettings></application>';

// Strict bounded PE resource reader, not a general executable editor.
export function inspectPe(buffer) {
  const u16 = offset => buffer.readUInt16LE(offset), u32 = offset => buffer.readUInt32LE(offset);
  const pe = u32(0x3c), optional = pe + 24, directory = optional + 112;
  if (buffer.toString("ascii", 0, 2) !== "MZ" || u32(pe) !== 0x4550 ||
      u16(pe + 4) !== 0x8664 || u16(optional) !== 0x20b)
    throw new Error("Expected AMD64 PE32+");
  if (u32(directory + 32) || u32(directory + 36)) throw new Error("Signed binary rejected");
  const table = optional + u16(pe + 20), sections = [];
  for (let i = 0; i < u16(pe + 6); i++) {
    const at = table + i * 40;
    sections.push({ name: buffer.toString("ascii", at, at + 8).replace(/\0.*$/, ""),
      at, virtualSize: u32(at + 8), rva: u32(at + 12), rawSize: u32(at + 16), rawOffset: u32(at + 20) });
  }
  const rvaOffset = rva => {
    const section = sections.find(s => rva >= s.rva && rva < s.rva + s.rawSize);
    if (!section) throw new Error("Resource RVA outside file sections");
    return section.rawOffset + rva - section.rva;
  };
  const resourceRva = u32(directory + 16), root = rvaOffset(resourceRva), leaves = [];
  const visit = (offset, ids = []) => {
    if (ids.length > 3 || offset < root || offset + 16 > root + u32(directory + 20))
      throw new Error("Resource directory boundary rejected");
    const count = u16(offset + 12) + u16(offset + 14);
    for (let i = 0; i < count; i++) {
      const entry = offset + 16 + i * 8, name = u32(entry), target = u32(entry + 4);
      const next = [...ids, name];
      if (target & 0x80000000) visit(root + (target & 0x7fffffff), next);
      else {
        const at = root + target, rva = u32(at), size = u32(at + 4);
        leaves.push({ ids: next, at, rva, size, offset: rvaOffset(rva) });
      }
    }
  };
  visit(root);
  const manifests = leaves.filter(e => e.ids[0] === 24 && e.ids[1] === 1);
  if (manifests.length !== 1) throw new Error("Expected exactly one embedded process manifest");
  const manifest = manifests[0];
  const section = sections.find(s => manifest.offset >= s.rawOffset &&
    manifest.offset + manifest.size <= s.rawOffset + s.rawSize);
  if (section?.name !== ".rsrc") throw new Error("Manifest not in resource section");
  return { pe, optional, directory, resourceRva, sections, leaves, manifest, section,
    xml: buffer.toString("utf8", manifest.offset, manifest.offset + manifest.size) };
}

export function withUtf8Manifest(input, filename) {
  if (sha(input) !== originals[filename]) throw new Error("Unapproved vendor executable: " + filename);
  const before = inspectPe(input), { manifest, section } = before;
  if (!before.xml.includes("level='asInvoker'") || before.xml.includes("activeCodePage") ||
      before.xml.split("</assembly>").length !== 2)
    throw new Error("Unexpected original manifest");
  const replacement = Buffer.from(before.xml.replace("</assembly>", addition + "</assembly>"), "utf8");
  const end = manifest.offset + replacement.length;
  const oldEnd = manifest.offset + manifest.size;
  if (end > section.rawOffset + section.rawSize ||
      before.leaves.some(e => e !== manifest && e.offset + e.size > manifest.offset) ||
      input.subarray(oldEnd, end).some(byte => byte !== 0))
    throw new Error("Insufficient zero-filled manifest resource slack");
  const output = Buffer.from(input);
  replacement.copy(output, manifest.offset);
  output.writeUInt32LE(replacement.length, manifest.at + 4);
  const used = Math.max(section.virtualSize, end - section.rawOffset);
  output.writeUInt32LE(used, section.at + 8);
  output.writeUInt32LE(Math.max(input.readUInt32LE(before.directory + 20),
    end - section.rawOffset), before.directory + 20);
  // Original PE checksum is zero. Keep it zero; no image/section alignment or code is changed.
  if (input.readUInt32LE(before.optional + 64) !== 0) throw new Error("Unexpected vendor checksum");
  const after = inspectPe(output);
  if (!after.xml.includes(addition) || !after.xml.includes("level='asInvoker'"))
    throw new Error("Manifest read-back failed");
  const ranges = [
    [manifest.offset, end], [manifest.at + 4, manifest.at + 8],
    [section.at + 8, section.at + 12], [before.directory + 20, before.directory + 24],
  ];
  for (let i = 0; i < input.length; i++)
    if (input[i] !== output[i] && !ranges.some(([start, stop]) => i >= start && i < stop))
      throw new Error("Unexpected byte changed outside manifest resource metadata");
  const unchangedSections = before.sections.filter(s => s.name !== ".rsrc").map(s => {
    const original = input.subarray(s.rawOffset, s.rawOffset + s.rawSize);
    const patched = output.subarray(s.rawOffset, s.rawOffset + s.rawSize);
    if (!original.equals(patched)) throw new Error("Non-resource section changed");
    return { name: s.name, sha256: sha(original) };
  });
  for (const leaf of before.leaves.filter(e => e !== manifest))
    if (!input.subarray(leaf.offset, leaf.offset + leaf.size).equals(output.subarray(leaf.offset, leaf.offset + leaf.size)))
      throw new Error("Non-manifest resource changed");
  return { bytes: output, evidence: {
    file: filename, originalSha256: sha(input), patchedSha256: sha(output),
    processCodePageDeclaration: "UTF-8", minimumWindowsBuild: 18362,
    change: "Embedded manifest and its bounded resource size metadata only",
    asInvokerPreserved: true, sameFileLength: output.length === input.length,
    unchangedSections, otherResourcesUnchanged: true, windowsExecution: "NOT RUN",
  } };
}
