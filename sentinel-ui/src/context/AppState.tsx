/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
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

const STORAGE_KEY = 'sentinel.ui.state.v1';

function loadInitialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const saved = JSON.parse(raw) as Partial<AppState>;
    return {
      ...initialState,
      selectedProjectId: typeof saved.selectedProjectId === 'string' ? saved.selectedProjectId : null,
      currentView: saved.currentView ?? 'home',
      sidebarCollapsed: saved.sidebarCollapsed === true,
    };
  } catch {
    return initialState;
  }
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadInitialState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      selectedProjectId: state.selectedProjectId,
      currentView: state.currentView,
      sidebarCollapsed: state.sidebarCollapsed,
    }));
  }, [state.selectedProjectId, state.currentView, state.sidebarCollapsed]);

  const setProjects = useCallback((projects: Project[]) => {
    setState(prev => {
      const selectedStillExists = projects.some((p) => p.id === prev.selectedProjectId);
      const selectedProjectId = selectedStillExists ? prev.selectedProjectId : projects[0]?.id ?? null;
      return { ...prev, projects, selectedProjectId };
    });
  }, []);

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
