'use client';
import Link from 'next/link';
import {useSelectedLayoutSegment} from 'next/navigation';
import type {ProjectTab} from '@/lib/projects/workspace-view';
export function ProjectTabLinks({tabs,active}:{tabs:ProjectTab[];active:string|null|undefined}){
 return <nav aria-label="Sections du projet" className="mt-6 flex flex-wrap gap-1 border-b border-border">{tabs.map(tab=>{const current=active!==undefined&&tab.segment===active;
  return <Link key={tab.key} href={tab.href} aria-current={current?'page':undefined} className={`-mb-px rounded-t-lg border px-4 py-2 text-sm ${current?'border-border border-b-background bg-background font-semibold':'border-transparent text-muted hover:text-accent'}`}>{tab.label}</Link>;})}</nav>;
}
// The active tab follows the child route segment of the project layout.
export function ProjectTabs({tabs}:{tabs:ProjectTab[]}){return <ProjectTabLinks tabs={tabs} active={useSelectedLayoutSegment()}/>;}
