// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfficeMemberDetail } from "./OfficeMemberDetail";
import type { Student } from "../pages/members/MembersPage";
afterEach(cleanup);
const student: Student = { id: "synthetic", name: "합성회원", status: "active", created_at: "2026-10-01",
  assigned_class_ids: ["a", "b", "c"], schedule_labels: ["월4", "목7"],
  assignedClasses: [{ id: "a", name: "기초반", schedule_days: "월", schedule_time: "16:00", instructor: "합성 강사A" },
    { id: "b", name: "심화반", schedule_days: "목", schedule_time: "19:00", instructor: "합성 강사B" }] };
it("preserves array schedules, names and warns about partially missing multi-class enrichment", () => {
  render(<OfficeMemberDetail student={student} tab="classes" onTabChange={vi.fn()} onBack={vi.fn()} growth={null} />);
  expect(screen.getByText(/배정된 반 1건의 상세 정보가 미연결/)).toBeTruthy();
  expect(screen.getByText("기초반 · 심화반")).toBeTruthy();
  expect(screen.getByText(/월4, 목7/)).toBeTruthy();
  expect(screen.queryByText("미납 없음")).toBeNull();
});
it("distinguishes empty actual contacts from unavailable relationships and uses accessible collapsible sections", () => {
  render(<OfficeMemberDetail student={student} tab="contacts" onTabChange={vi.fn()} onBack={vi.fn()} growth={null} />);
  expect(screen.getAllByText("등록된 값 없음")).toHaveLength(3);
  expect(screen.getByText(/다중 보호자 연결은 이 버전에서 연결되지 않았습니다/)).toBeTruthy();
  const button = screen.getByRole("button", { name: /연락처·보호자/ });
  fireEvent.click(button); expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button); expect(button.getAttribute("aria-expanded")).toBe("true");
});
it("routes keyboard tabs through the same canonical tab targets", () => {
  const change = vi.fn();
  render(<OfficeMemberDetail student={student} tab="basic" onTabChange={change} onBack={vi.fn()} growth={null} />);
  fireEvent.keyDown(screen.getByRole("tab", { name: "기본정보" }), { key: "ArrowRight" });
  expect(change).toHaveBeenLastCalledWith("contacts");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "연락처·보호자" }));
});
