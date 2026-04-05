export const toLstmInput = (frames = []) => {
  return frames.map((frame) => frame.keypoints || []);
};
