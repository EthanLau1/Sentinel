import { useEffect } from 'react';
import { ConsoleLayout } from './components/Layout/ConsoleLayout';
import { Home } from './views/Home';
import { ProjectOverview } from './views/ProjectOverview';
import { RunCenter } from './views/RunCenter';
import { DebugWorkspace } from './views/DebugWorkspace';
import { Settings } from './views/Settings';
import { useApp } from './context/AppState';
import { apiClient } from './api/client';

function AppContent(): React.JSX.Element {
  const { state, setProjects } = useApp();

  useEffect(() => {
    apiClient.getProjects().then((projects) => {
      setProjects(projects);
    }).catch(err => {
      console.error('Failed to fetch projects', err);
    });
  }, [setProjects]);

  return (
    <ConsoleLayout>
      {state.currentView === 'home' && <Home />}
      {state.currentView === 'overview' && <ProjectOverview />}
      {state.currentView === 'run' && <RunCenter />}
      {state.currentView === 'debug' && <DebugWorkspace />}
      {state.currentView === 'settings' && <Settings />}
    </ConsoleLayout>
  );
}

import { AppProvider } from './context/AppState';

export default function App(): React.JSX.Element {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
