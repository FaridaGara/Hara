"use client";
import { useEventDraft } from '@/hooks/use-event-draft';
import { SeatPlanEditor } from '@/components/seat-plan-editor';
import { EMPTY_EVENT_DRAFT, emptySales, type EventDraft } from '@/lib/event-draft';
import { useState } from 'react';
import { seatPlansApi } from '@/lib/api/seat-plans';
const fixture:EventDraft={...EMPTY_EVENT_DRAFT,sales:{...emptySales(),admissionType:'seated',capacity:'100'}};
export default function Verification(){
 const state=useEventDraft(987654321);
 const [start,setStart]=useState(false);
 const [done,setDone]=useState(false);
 if(!start)return <div><button onClick={()=>{state.replaceDraft(fixture);setStart(true);}}>Yeni test</button><button onClick={()=>setStart(true)}>Qaralamaya davam et</button><button onClick={()=>{document.documentElement.dataset.theme='dark';}}>Tünd mövzu</button></div>;
 seatPlansApi.save=async plan=>({id:plan.id,name:plan.name,seat_count:plan.blocks.flatMap(b=>b.seats).length,blocked_count:plan.blocks.flatMap(b=>b.seats).filter(s=>s.blocked).length});
 seatPlansApi.list=async()=>[];
 return done?<p>{state.draft.sales.tickets.reduce((n,t)=>n+Number(t.quantity),0)} satış yeri tətbiq edildi</p>:<SeatPlanEditor draft={state.draft} updateDraft={state.replaceDraft} save={state.save} onDone={()=>setDone(true)}/>;
}
