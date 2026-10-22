import React, { createContext, useContext, useState, useEffect } from 'react';
import { INSTRUMENTS, readInstrument } from './instruments.js';
const InstrumentContext = createContext({ instrument: INSTRUMENTS.violin });
export const useInstrument = () => useContext(InstrumentContext);
export function InstrumentProvider({ children }) {
  const [id, setInstrument] = useState(readInstrument);
  useEffect(() => {
    try {
      localStorage.setItem('arco-instrument', id);
    } catch {}
  }, [id]);
  return (
    <InstrumentContext.Provider value={{ instrument: INSTRUMENTS[id], setInstrument }}>
      <React.Fragment key={id}>{children}</React.Fragment>
    </InstrumentContext.Provider>
  );
}
