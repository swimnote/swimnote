import {it,expect} from "vitest";
import {validateData} from "../office-operations-data.js";
const competitionId="84e17c0b-c125-4825-8ded-0833b987ceda";
it("keeps competition participation as an explicit linked member record, not an external registration",()=>{
  const d=validateData("support",{name:"센터 참가",kind:"competition",status:"planned",competitionId,studentId:"member"});
  expect(d).toMatchObject({competitionId,studentId:"member",status:"planned"});
  expect(d).not.toHaveProperty("submittedToOrganizer");
});
it("rejects an incomplete participant or unrelated facility carrying a member link",()=>{
  for(const value of [
    {kind:"competition",competitionId},{kind:"competition",studentId:"member"},
    {kind:"facility",competitionId,studentId:"member"},
  ])expect(()=>validateData("support",{name:"기록",status:"planned",...value})).toThrow();
});
it("does not turn campaign participation into media consent",()=>{
  const c=validateData("contacts",{name:"신청자",phone:"01012345678",stage:"inquiry",campaignId:competitionId,source:"소개"});
  expect(c).not.toHaveProperty("consentReference");
  expect(()=>validateData("marketing",{name:"홍보",channel:"manual",status:"draft",materialUrl:"https://example.com/image"})).toThrow();
});
