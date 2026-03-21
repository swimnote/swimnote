/**
 * adapters/storageAdapter.ts
 * 스토리지 어댑터 인터페이스 — 현재는 mock 구현
 * 나중에 Cloudflare R2 연결 시 이 파일만 교체
 */

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const storageAdapter = {
  async uploadPreviewFree(file: { name: string; sizeMb: number }, operatorId: string): Promise<string> {
    await delay(300)
    return `${operatorId}/free/${file.name}-low.jpg`
  },

  async uploadPreviewPaid(file: { name: string; sizeMb: number }, operatorId: string): Promise<string> {
    await delay(300)
    return `${operatorId}/paid/${file.name}-hd.jpg`
  },

  async deleteAsset(key: string): Promise<boolean> {
    await delay(200)
    console.log(`[mock] 삭제: ${key}`)
    return true
  },

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    await delay(100)
    return `https://mock-r2.dev/${key}?token=mock&expires=${expiresInSeconds}`
  },

  async calculateUsage(operatorId: string): Promise<{ usedMb: number }> {
    await delay(150)
    return { usedMb: Math.floor(Math.random() * 10000) }
  },
}
