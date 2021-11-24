import { useEffect, useState } from 'react';

export function Timer({ render }) {
  const [counter, setCounter] = useState(0);
  const [intervalId, setIntervalId] = useState(null);

  useEffect(() => {
    setIntervalId(
      setInterval(() => {
        setCounter((prevCounter) => prevCounter + 1);
      }, 1)
    );

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  return render({ counter, intervalId });
}
