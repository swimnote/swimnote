/** Conservative literal grounding, not a general Korean intent parser or member resolver. */
export function isOfficeSearch(text: string) {
  return /검색|찾아|조회|정보.{0,8}보여/i.test(text);
}
export function mixedOfficeSearch(text: string) {
  const positive = text.replace(/(?:아무것도\s*)?(?:수정|변경|이동|삭제)하지\s*(?:마(?:세요)?|말아(?:줘)?|않(?:아|고|습니다)?)[.!。\s]*/g, "");
  return isOfficeSearch(text) && /수정|변경|바꿔|바꾸|이동|옮겨|발송|결제|환불|삭제|update|change|move/i.test(positive);
}
export function groundedOfficeSearch(text: string, generated: string): string | null {
  if (!isOfficeSearch(text) || mixedOfficeSearch(text) || !generated.trim()) return null;
  const quoted = [...text.matchAll(/["“‘']([^"“”‘’']{1,200})["”’']/gu)];
  let literal: string | undefined, descriptor: string | undefined;
  if (quoted.length === 1) literal = quoted[0][1].trim();
  else if (quoted.length > 1) return null;
  else {
    const field = text.match(/^(.+?)\s+(이름|회원명|성명|전화번호|연락처)(?:으로|로|을|를)?\s*(?:검색|찾아|조회)/);
    if (field) { literal = field[1].trim(); descriptor = field[2]; }
    else literal = text.match(/^(.+?)\s+(?:검색|찾아(?:줘|주세요|봐)|조회|정보(?:를)?\s*보여)/)?.[1].trim();
  }
  if (!literal || literal.length > 200) return null;
  const value = generated.trim();
  const phone = (v: string) => /^\+?[\d ()-]{9,24}$/.test(v) && v.replace(/\D/g, "").length >= 9
    ? v.replace(/[ ()-]/g, "") : null;
  if (phone(literal) && phone(literal) === phone(value)) return phone(literal);
  if (value === literal || descriptor && value === `${literal} ${descriptor}`) return literal;
  return null; // Never broaden a name, invent a contact, choose a member, or silently execute part of a request.
}
