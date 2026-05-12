/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarTrigger,
} from '@renderer/components/ui/sidebar';

import logoVector from '@resources/logo-vector.png?url';

interface HeaderProps {
  showTrigger: boolean;
}

export function NeuraHeader({ showTrigger }: HeaderProps) {
  return (
    <SidebarMenu className="items-center">
      <SidebarMenuButton
        // size="lg"
        className="group-data-[collapsible=icon]:p-0! mb-3 h-12 rounded-lg data-[state=open]:bg-white/8 data-[state=open]:text-white hover:bg-white/6"
      >
        <div className="flex aspect-square size-9 items-center justify-center rounded-md border border-white/10 bg-[#111]">
          <img src={logoVector} alt="Neura" className="rounded-xl" />
        </div>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate text-base font-semibold tracking-normal text-white">
            Neura
          </span>
          <span className="truncate text-xs text-muted-foreground">
            Developer Agent
          </span>
        </div>
      </SidebarMenuButton>
      {showTrigger && (
        <SidebarTrigger className="absolute top-12 right-2 group-data-[collapsible=icon]:right-[-36px]" />
      )}
    </SidebarMenu>
  );
}
