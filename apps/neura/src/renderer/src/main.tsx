/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createRoot } from 'react-dom/client';

import App from './App';

document.documentElement.classList.add('dark');
document.body.classList.add('neura-shell');

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<App />);
