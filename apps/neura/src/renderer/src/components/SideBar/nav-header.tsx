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
      <SidebarMenuButton className="group-data-[collapsible=icon]:p-0! mb-7 h-12 rounded-xl px-2 data-[state=open]:bg-white/[0.08] data-[state=open]:text-white hover:bg-white/[0.06]">
        <div className="flex aspect-square size-10 items-center justify-center rounded-xl">
          <img src={logoVector} alt="Neura" className="rounded-xl" />
        </div>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate text-xl font-semibold tracking-normal text-white">
            Neura
          </span>
        </div>
      </SidebarMenuButton>
      {showTrigger && (
        <SidebarTrigger className="absolute top-12 right-2 group-data-[collapsible=icon]:right-[-36px]" />
      )}
    </SidebarMenu>
  );
}
