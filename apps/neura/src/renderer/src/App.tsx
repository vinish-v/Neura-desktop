/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Route, HashRouter, Routes } from 'react-router';
import { lazy, Suspense } from 'react';
import { Toaster } from 'sonner';

import { MainLayout } from './layouts/MainLayout';

import './styles/globals.css';

const Home = lazy(() => import('./pages/home'));
const LocalOperator = lazy(() => import('./pages/local'));
const Projects = lazy(() => import('./pages/projects'));
const Skills = lazy(() => import('./pages/skills'));
const Dashboard = lazy(() => import('./pages/dashboard'));
const Connectors = lazy(() => import('./pages/connectors'));

export default function App() {
  return (
    <HashRouter>
      <Suspense
        fallback={
          <div className="loading-container">
            <div className="loading-spinner" />
          </div>
        }
      >
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/local" element={<LocalOperator />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/connectors" element={<Connectors />} />
          </Route>
        </Routes>
        <Toaster
          position="top-right"
          offset={{ top: '48px' }}
          mobileOffset={{ top: '48px' }}
        />
      </Suspense>
    </HashRouter>
  );
}
