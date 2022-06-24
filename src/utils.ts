function isDateOnOrBeforeNow(date: Date) {
  return date <= new Date();
}

function getDateTimeDiff(minutes: number = 1) {
  return new Date(new Date().getTime() + minutes * 60000);
}
function addMsToDate(ms: number) {
  return new Date(new Date().getTime() + ms);
}
export { isDateOnOrBeforeNow, getDateTimeDiff, addMsToDate };
