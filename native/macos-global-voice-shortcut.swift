import CoreGraphics
import Darwin
import Foundation

private let pollIntervalMicroseconds: useconds_t = 12_000
private let defaultSettleMilliseconds: UInt64 = 120

private enum VoiceMode: String {
  case dictation
  case task
}

private enum ShortcutState {
  case idle
  case settling(deadlineMilliseconds: UInt64)
  case active(VoiceMode)
  case awaitAllReleased
}

private let settleMilliseconds = UInt64(CommandLine.arguments.dropFirst().first ?? "")
  ?? defaultSettleMilliseconds
private var state = ShortcutState.idle

private func emit(_ value: String) {
  let data = Data("\(value)\n".utf8)
  try? FileHandle.standardOutput.write(contentsOf: data)
}

emit("ready")

while true {
  let flags = CGEventSource.flagsState(.combinedSessionState)
  let commandDown = flags.contains(.maskCommand)
  let controlDown = flags.contains(.maskControl)
  let shiftDown = flags.contains(.maskShift)
  let baseDown = commandDown && controlDown
  let anyBaseDown = commandDown || controlDown
  let nowMilliseconds = DispatchTime.now().uptimeNanoseconds / 1_000_000

  switch state {
  case .idle:
    if baseDown && shiftDown {
      state = .active(.task)
      emit("pressed:task")
    } else if baseDown {
      state = .settling(deadlineMilliseconds: nowMilliseconds + settleMilliseconds)
    }
  case .settling(let deadlineMilliseconds):
    if !baseDown {
      state = .awaitAllReleased
    } else if nowMilliseconds >= deadlineMilliseconds {
      state = .active(.dictation)
      emit("pressed:dictation")
    } else if shiftDown {
      state = .active(.task)
      emit("pressed:task")
    }
  case .active(let mode):
    let remainsActive = mode == .task ? baseDown && shiftDown : baseDown
    if !remainsActive {
      emit("released:\(mode.rawValue)")
      state = .awaitAllReleased
    }
  case .awaitAllReleased:
    if !anyBaseDown {
      state = .idle
    }
  }

  usleep(pollIntervalMicroseconds)
}
