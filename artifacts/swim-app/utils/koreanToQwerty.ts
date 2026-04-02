/**
 * 한글 자모 → QWERTY 키 매핑 (두벌식 표준 키보드)
 * 한글 입력 상태에서 타이핑해도 영문으로 변환해준다.
 */

const JAMO_TO_QWERTY: Record<string, string> = {
  // 자음 (왼쪽 자판)
  "ㅂ": "q", "ㅈ": "w", "ㄷ": "e", "ㄱ": "r", "ㅅ": "t",
  "ㅁ": "a", "ㄴ": "s", "ㅇ": "d", "ㄹ": "f", "ㅎ": "g",
  "ㅋ": "z", "ㅌ": "x", "ㅊ": "c", "ㅍ": "v",
  // 모음 (오른쪽 자판)
  "ㅛ": "y", "ㅕ": "u", "ㅑ": "i", "ㅐ": "o", "ㅔ": "p",
  "ㅗ": "h", "ㅓ": "j", "ㅏ": "k", "ㅣ": "l",
  "ㅠ": "b", "ㅜ": "n", "ㅡ": "m",
  // 쌍자음 (Shift)
  "ㅃ": "Q", "ㅉ": "W", "ㄸ": "E", "ㄲ": "R", "ㅆ": "T",
  "ㅒ": "O", "ㅖ": "P",
  // 복합 종성 → 분해 매핑은 아래 decomposeJongseong에서 처리
};

// 초성 인덱스 → 자모
const CHOSEONG = [
  "ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ",
  "ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ",
];
// 중성 인덱스 → 자모
const JUNGSEONG = [
  "ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ",
  "ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ",
];
// 종성 인덱스 → 자모 (복합 종성 포함)
const JONGSEONG = [
  "","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ",
  "ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ",
];
// 복합 종성 분해
const JONGSEONG_DECOMPOSE: Record<string, string[]> = {
  "ㄳ": ["ㄱ","ㅅ"], "ㄵ": ["ㄴ","ㅈ"], "ㄶ": ["ㄴ","ㅎ"],
  "ㄺ": ["ㄹ","ㄱ"], "ㄻ": ["ㄹ","ㅁ"], "ㄼ": ["ㄹ","ㅂ"],
  "ㄽ": ["ㄹ","ㅅ"], "ㄾ": ["ㄹ","ㅌ"], "ㄿ": ["ㄹ","ㅍ"],
  "ㅀ": ["ㄹ","ㅎ"], "ㅄ": ["ㅂ","ㅅ"],
};
// 복합 중성 분해
const JUNGSEONG_DECOMPOSE: Record<string, string[]> = {
  "ㅘ": ["ㅗ","ㅏ"], "ㅙ": ["ㅗ","ㅐ"], "ㅚ": ["ㅗ","ㅣ"],
  "ㅝ": ["ㅜ","ㅓ"], "ㅞ": ["ㅜ","ㅔ"], "ㅟ": ["ㅜ","ㅣ"],
  "ㅢ": ["ㅡ","ㅣ"],
};

function decomposeHangulSyllable(char: string): string[] {
  const code = char.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return [char]; // 한글 음절 아님

  const offset = code - 0xAC00;
  const jongIdx = offset % 28;
  const jungIdx = Math.floor((offset - jongIdx) / 28) % 21;
  const choIdx  = Math.floor(offset / 28 / 21);

  const cho  = CHOSEONG[choIdx];
  const jung = JUNGSEONG[jungIdx];
  const jong = JONGSEONG[jongIdx];

  const result: string[] = [cho];
  // 복합 중성 분해
  const jungDecomposed = JUNGSEONG_DECOMPOSE[jung];
  if (jungDecomposed) result.push(...jungDecomposed);
  else result.push(jung);
  // 복합 종성 분해
  if (jong) {
    const jongDecomposed = JONGSEONG_DECOMPOSE[jong];
    if (jongDecomposed) result.push(...jongDecomposed);
    else result.push(jong);
  }
  return result;
}

/**
 * 한글 문자를 두벌식 QWERTY 영문으로 변환한다.
 * 예) "안녕" → "dkssud" (실제 키보드 입력 기준)
 */
export function koreanToQwerty(text: string): string {
  return text
    .split("")
    .flatMap(char => {
      const jamos = decomposeHangulSyllable(char);
      return jamos.map(j => JAMO_TO_QWERTY[j] ?? j);
    })
    .join("");
}

/**
 * 영문/숫자/특수문자만 남기고, 한글은 QWERTY로 변환 후 처리.
 * TextInput onChangeText에 사용.
 */
export function toAsciiOnly(text: string): string {
  const converted = koreanToQwerty(text);
  return converted.replace(/[^\x20-\x7E]/g, "");
}
