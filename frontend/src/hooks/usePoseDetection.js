import { useState } from "react";

const usePoseDetection = () => {
  const [isDetecting, setIsDetecting] = useState(false);

  const startDetection = () => setIsDetecting(true);
  const stopDetection = () => setIsDetecting(false);

  return {
    isDetecting,
    startDetection,
    stopDetection,
  };
};

export default usePoseDetection;
