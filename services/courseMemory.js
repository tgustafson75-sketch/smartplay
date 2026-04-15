let courseMemory = {};

export const updateCourseMemory = (holeNumber, shotResult) => {
  if (!courseMemory[holeNumber]) {
    courseMemory[holeNumber] = { left: 0, right: 0 };
  }

  if (shotResult === 'left') courseMemory[holeNumber].left++;
  if (shotResult === 'right') courseMemory[holeNumber].right++;
};

export const getCourseMemory = (holeNumber) => {
  const data = courseMemory[holeNumber];
  if (!data) return null;
  if (data.right >= data.left + 2) return 'right';
  if (data.left >= data.right + 2) return 'left';
  return null;
};

export const resetCourseMemory = () => {
  courseMemory = {};
};