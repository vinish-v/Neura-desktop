/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ComputerUseUserData } from '@neura-desktop/shared/types';

function replaceStringWithFirstAppearance(
  str: string,
  target: string,
  replacement: string,
) {
  const index = str.indexOf(target);
  return str.slice(0, index) + replacement + str.slice(index + target.length);
}

export function reportHTMLContent(
  tpl: string,
  dumpData: ComputerUseUserData[],
): string {
  let reportContent = '';
  if (
    (Array.isArray(dumpData) && dumpData.length === 0) ||
    typeof dumpData === 'undefined'
  ) {
    reportContent = replaceStringWithFirstAppearance(
      tpl,
      '{{dump}}',
      `<script type="neura_web_dump" type="application/json"></script>`,
    );
  } else if (typeof dumpData === 'string') {
    reportContent = replaceStringWithFirstAppearance(
      tpl,
      '{{dump}}',
      `<script type="neura_web_dump" type="application/json">${dumpData}</script>`,
    );
  } else {
    const dumps = dumpData.map((data) => {
      return `<script type="neura_web_dump" type="application/json">${JSON.stringify(data)}\n</script>`;
    });
    reportContent = replaceStringWithFirstAppearance(
      tpl,
      '{{dump}}',
      dumps.join('\n'),
    );
  }

  return reportContent;
}
