import { createContext, useContext } from 'react';

/** Places any panel can open without every view passing them down: the shot list, for now. */
export interface Nav {
  openShots?: (cinematicId: string) => void;
}

export const NavContext = createContext<Nav>({});
export const useNav = (): Nav => useContext(NavContext);
