import { createContext, useContext } from 'react';

/** Places any panel can open without every view passing them down: the shot list and the levels. */
export interface Nav {
  openShots?: (cinematicId: string) => void;
  /** The Level Designer, on an item or on the items linked to a story element. */
  openLevels?: (focus?: string) => void;
  /** The Puzzle Creator, on a puzzle. */
  openPuzzles?: (puzzleId?: string) => void;
}

export const NavContext = createContext<Nav>({});
export const useNav = (): Nav => useContext(NavContext);
