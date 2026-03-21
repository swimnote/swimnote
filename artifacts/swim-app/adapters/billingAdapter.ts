/**
 * adapters/billingAdapter.ts
 * 결제 어댑터 인터페이스 — 현재는 mock 구현
 * 나중에 PortOne + 국내 PG 연결 시 이 파일만 교체
 */

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const billingAdapter = {
  async createBillingCustomer(operatorId: string, name: string, email: string): Promise<string> {
    await delay(200)
    return `mock-customer-${operatorId}`
  },

  async requestFirstCharge(customerId: string, amount: number): Promise<{ success: boolean; txId: string }> {
    await delay(500)
    return { success: true, txId: `mock-tx-${Date.now()}` }
  },

  async requestRecurringCharge(customerId: string, amount: number, creditUsed = 0): Promise<{ success: boolean; txId: string; failReason?: string }> {
    await delay(500)
    const netAmount = Math.max(0, amount - creditUsed)
    if (netAmount === 0) {
      return { success: true, txId: `mock-credit-${Date.now()}` }
    }
    // mock: 10% 확률로 실패
    const success = Math.random() > 0.1
    return success
      ? { success: true, txId: `mock-tx-${Date.now()}` }
      : { success: false, txId: '', failReason: '카드 잔액 부족' }
  },

  async cancelRecurring(customerId: string): Promise<boolean> {
    await delay(300)
    return true
  },

  async refundPayment(txId: string, amount: number): Promise<{ success: boolean }> {
    await delay(500)
    return { success: true }
  },

  async applyCredit(operatorId: string, amount: number): Promise<boolean> {
    await delay(200)
    return true
  },
}
