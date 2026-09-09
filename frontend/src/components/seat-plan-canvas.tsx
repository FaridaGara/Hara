"use client";

import Image from 'next/image';
import { useRef, useState, type PointerEvent } from 'react';
import type { PlanBlock, SeatPlanDraft } from '@/lib/seat-plan';
import css from './seat-plan.module.css';

export function SeatPlanCanvas({ plan, editing, activeBlock, onBlock, onSelectBlock }: {
  plan: SeatPlanDraft; editing?: boolean; activeBlock?: string;
  onBlock?: (block: PlanBlock) => void; onSelectBlock?: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; block: PlanBlock; resize: boolean; unit: number } | null>(null);
  function start(event: PointerEvent<HTMLDivElement>, block: PlanBlock, resize = false) {
    if (!editing || !onBlock) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    onSelectBlock?.(block.id);
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, block, resize, unit: 1000 / (viewport.current?.getBoundingClientRect().width || 338) / zoom };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current; if (!d || d.pointer !== event.pointerId || !onBlock) return;
    const dx = (event.clientX - d.x) * d.unit, dy = (event.clientY - d.y) * d.unit;
    onBlock(d.resize ? { ...d.block, scale: Math.max(.1, Math.min(3, d.block.scale + dx / 350)) } : { ...d.block, x: Math.max(-500, Math.min(900, d.block.x + dx)), y: Math.max(-400, Math.min(600, d.block.y + dy)) });
  }
  return <div className={css.canvasCard}>
    <strong>{editing ? 'Bloku sürüşdür · Küncdən ölçüləndir' : `${plan.blocks.reduce((n,b) => n+b.seats.length,0)} yer · Fon kilidlidir`}</strong>
    <div className={css.viewport} ref={viewport}>
      <div className={css.zoomSurface} style={{ width: `${zoom * 100}%` }}>
        <div className={css.canvas}>
          {plan.background ? <Image unoptimized fill sizes="370px" src={plan.background} alt="Məkan planının fonu" className={css.background} draggable={false} /> : <span className={css.noBackground}>Məkan planı</span>}
          {plan.blocks.map((block) => {
            const width = Math.max(...block.seats.map(s=>s.x), 0) + 52, height = Math.max(...block.seats.map(s=>s.y), 0) + 52;
            return <div key={block.id} className={`${css.block} ${editing && activeBlock === block.id ? css.activeBlock : ''}`}
              style={{ left: `${block.x / 10}%`, top: `${block.y / 6.5}%`, width: `${width / 10}%`, height: `${height / 6.5}%`, transform: `rotate(${block.rotation}deg) scale(${block.scale})`, touchAction: editing ? 'none' : 'auto' }}
              onPointerDown={e=>start(e,block)} onPointerMove={move} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
              {block.seats.map(seat => <span key={seat.id} className={`${css.dot} ${seat.blocked ? css.blockedDot : seat.categoryId ? css.assignedDot : ''}`}
                title={`${block.name} · ${seat.row}${seat.number}${seat.blocked ? ' · Bağlı' : ''}`}
                style={{ left: `${seat.x/width*100}%`, top: `${seat.y/height*100}%`, width: `${44/width*100}%`, height: `${36/height*100}%` }} />)}
              {[...new Set(block.seats.map(s=>s.row))].map(row=>{const first=block.seats.find(s=>s.row===row)!;return <span key={row} className={css.rowLabel} style={{left:`${(first.x-40)/width*100}%`,top:`${first.y/height*100}%`}}>{row}</span>;})}
              {editing && activeBlock === block.id ? <div role="slider" tabIndex={0} aria-label="Blokun ölçüsü" aria-valuenow={Math.round(block.scale*100)} aria-valuemin={10} aria-valuemax={300} className={css.resizeHandle}
                onPointerDown={e=>start(e,block,true)} onKeyDown={e=>{if(['ArrowRight','ArrowUp','ArrowLeft','ArrowDown'].includes(e.key)){e.preventDefault();onBlock?.({...block,scale:Math.max(.1,Math.min(3,block.scale+(['ArrowRight','ArrowUp'].includes(e.key)?.05:-.05)))});}}} /> : null}
            </div>;
          })}
        </div>
      </div>
    </div>
    <div className={css.zoomControls}><button type="button" onClick={()=>setZoom(v=>Math.max(1,v-.5))} disabled={zoom===1} aria-label="Planı kiçilt">−</button><span>{Math.round(zoom*100)}%</span><button type="button" onClick={()=>setZoom(v=>Math.min(4,v+.5))} disabled={zoom===4} aria-label="Planı böyüt">+</button></div>
    <small>Yerlər · Qiymətli yerlər · Bağlı yerlər</small>
  </div>;
}
