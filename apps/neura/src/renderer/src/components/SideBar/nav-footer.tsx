/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Settings } from 'lucide-react';

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
} from '@renderer/components/ui/sidebar';

interface NavSettingsProps {
  onClick: () => void;
}

export function NavSettings({ onClick }: NavSettingsProps) {
  return (
    <SidebarGroup>
      <SidebarMenu className="items-center">
        <SidebarMenuButton
          className="rounded-2xl font-medium text-white/85 hover:bg-white/8 hover:text-white"
          onClick={onClick}
        >
          <Settings />
          <span>Settings</span>
        </SidebarMenuButton>
      </SidebarMenu>
    </SidebarGroup>
  );
}
