/**
 * subscriptionStore — STUB
 *
 * 실제 구현 파일이 없어 Web 번들 컴파일용 임시 스텁입니다.
 */

import { create } from 'zustand';

interface SubscriptionState {
  plan:       string | null;
  expiry:     string | null;
  setPlan:    (plan: string | null) => void;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  plan:    null,
  expiry:  null,
  setPlan: (plan) => set({ plan }),
}));
