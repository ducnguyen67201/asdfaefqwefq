import CoreGraphics
import Darwin
import Foundation

private let pollIntervalMicroseconds: useconds_t = 12_000
private let defaultSettleMilliseconds: UInt64 = 120

private enum ShortcutState {
  case idle
  case settling(deadlineMilliseconds: UInt64)
  case active
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
  let baseDown = commandDown && controlDown
  let anyBaseDown = commandDown || controlDown
  let nowMilliseconds = DispatchTime.now().uptimeNanoseconds / 1_000_000

  switch state {
  case .idle:
    if baseDown {
      state = .settling(deadlineMilliseconds: nowMilliseconds + settleMilliseconds)
    }
  case .settling(let deadlineMilliseconds):
    if !baseDown {
      state = .awaitAllReleased
    } else if nowMilliseconds >= deadlineMilliseconds {
      state = .active
      emit("pressed")
    }
  case .active:
    if !baseDown {
      emit("released")
      state = .awaitAllReleased
    }
  case .awaitAllReleased:
    if !anyBaseDown {
      state = .idle
    }
  }

  usleep(pollIntervalMicroseconds)
}
