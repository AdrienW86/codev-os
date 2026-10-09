'use client';
import Link from 'next/link';
import {useSelectedLayoutSegment} from 'next/navigation';
import type {ProjectTab} from '@/lib/projects/workspace-view';
export function ProjectTabLinks({tabs,active}:{tabs:ProjectTab[];active:string|null|undefined}){
 return <nav aria-label="Sections du projet" className="mt-6 mb-8 flex gap-1 overflow-x-auto border-b border-border">{tabs.map(tab=>{const current=active!==undefined&&tab.segment===active;
  return <Link key={tab.key} href={tab.href} aria-current={current?'page':undefined} className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm transition-colors ${current?'border-accent font-medium text-foreground':'border-transparent text-muted hover:text-foreground'}`}>{tab.label}</Link>;})}</nav>;
}
// The active tab follows the child route segment of the project layout.
export function ProjectTabs({tabs}:{tabs:ProjectTab[]}){return <ProjectTabLinks tabs={tabs} active={useSelectedLayoutSegment()}/>;}
