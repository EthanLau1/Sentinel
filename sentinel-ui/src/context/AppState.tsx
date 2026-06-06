/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { Project } from '../types';

interface AppState {
  projects: Project[];
  selectedProjectId: string | null;
  sidebarCollapsed: boolean;
  currentView: 'home' | 'overview' | 'run' | 'debug' | 'settings';
}

interface AppContextType {
  state: AppState;
  setProjects: (projects: Project[]) => void;
  selectProject: (id: string) => void;
  toggleSidebar: () => void;
  navigate: (view: AppState['currentView']) => void;
}

// Initial state
const initialState: AppState = {
  projects: [],
  selectedProjectId: null,
  sidebarCollapsed: false,
  currentView: 'home',
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);

  const setProjects = (projects: Project[]) => {
    setState(prev => ({ ...prev, projects }));
  };

  const selectProject = (id: string) => {
    setState(prev => ({ ...prev, selectedProjectId: id, currentView: 'overview' }));
  };

  const toggleSidebar = () => {
    setState(prev => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }));
  };

  const navigate = (view: AppState['currentView']) => {
    setState(prev => ({ ...prev, currentView: view }));
  };

  return (
    <AppContext.Provider value={{ state, setProjects, selectProject, toggleSidebar, navigate }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
