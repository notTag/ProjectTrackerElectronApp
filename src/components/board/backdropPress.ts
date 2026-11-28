// click fires on the common ancestor of press + release, so dragging a resizable
// modal's edge and letting go over the backdrop would otherwise close the modal.
// One instance per modal: only one guarded modal is ever open at a time.
export const useBackdropPress = () => {
  let pressStartedOnBackdrop = false

  const notePressTarget = (event: PointerEvent) => {
    const isEdgeResize = event.defaultPrevented
    pressStartedOnBackdrop = event.target === event.currentTarget && !isEdgeResize
  }

  const closeIfPressStartedOnBackdrop = (close: () => void) => {
    const startedOnBackdrop = pressStartedOnBackdrop
    pressStartedOnBackdrop = false
    if (startedOnBackdrop) close()
  }

  return { notePressTarget, closeIfPressStartedOnBackdrop }
}
