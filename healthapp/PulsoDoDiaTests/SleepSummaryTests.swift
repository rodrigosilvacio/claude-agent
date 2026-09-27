import XCTest
@testable import PulsoDoDia

final class SleepSummaryTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_790_000_000)
    private func at(_ minutes: Double) -> Date { base.addingTimeInterval(minutes * 60) }
    private lazy var window = DateInterval(start: at(-600), end: at(900))

    func testSingleSegmentCountsFullDuration() throws {
        let summary = try XCTUnwrap(SleepSummary.aggregate(
            [SleepSegment(stage: .core, start: at(0), end: at(480))], in: window))
        XCTAssertEqual(summary.asleep, 480 * 60)
        XCTAssertEqual(summary.bedtime, at(0))
        XCTAssertEqual(summary.wakeTime, at(480))
    }

    func testOverlappingSourcesAreNotCountedTwice() throws {
        // iPhone registra "dormindo" das 22h30 às 7h; Apple Watch registra fases das 23h às 7h.
        let segments = [
            SleepSegment(stage: .unspecified, start: at(-30), end: at(480)),
            SleepSegment(stage: .core, start: at(0), end: at(240)),
            SleepSegment(stage: .deep, start: at(240), end: at(480)),
        ]
        let summary = try XCTUnwrap(SleepSummary.aggregate(segments, in: window))
        XCTAssertEqual(summary.asleep, 510 * 60)
        XCTAssertEqual(summary.duration(of: .unspecified), 30 * 60)
        XCTAssertEqual(summary.duration(of: .core), 240 * 60)
        XCTAssertEqual(summary.duration(of: .deep), 240 * 60)
    }

    func testAwakeFromWatchOverridesGenericAsleep() throws {
        let segments = [
            SleepSegment(stage: .unspecified, start: at(0), end: at(480)),
            SleepSegment(stage: .awake, start: at(200), end: at(230)),
        ]
        let summary = try XCTUnwrap(SleepSummary.aggregate(segments, in: window))
        XCTAssertEqual(summary.asleep, 450 * 60)
        XCTAssertEqual(summary.duration(of: .awake), 30 * 60)
    }

    func testSegmentsAreClippedToWindow() throws {
        let narrow = DateInterval(start: at(0), end: at(60))
        let summary = try XCTUnwrap(SleepSummary.aggregate(
            [SleepSegment(stage: .rem, start: at(-30), end: at(90))], in: narrow))
        XCTAssertEqual(summary.asleep, 60 * 60)
    }

    func testOnlyAwakeReturnsNil() {
        XCTAssertNil(SleepSummary.aggregate(
            [SleepSegment(stage: .awake, start: at(0), end: at(30))], in: window))
        XCTAssertNil(SleepSummary.aggregate([], in: window))
    }

    func testNightWindowGoesFromSixPMToNoon() {
        let calendar = Calendar(identifier: .gregorian)
        let morning = calendar.date(from: DateComponents(year: 2026, month: 9, day: 27, hour: 9))!
        let window = SleepSummary.nightWindow(for: morning, calendar: calendar)
        XCTAssertEqual(window.start, calendar.date(from: DateComponents(year: 2026, month: 9, day: 26, hour: 18)))
        XCTAssertEqual(window.end, morning)

        let evening = calendar.date(from: DateComponents(year: 2026, month: 9, day: 27, hour: 21))!
        XCTAssertEqual(SleepSummary.nightWindow(for: evening, calendar: calendar).end,
                       calendar.date(from: DateComponents(year: 2026, month: 9, day: 27, hour: 12)))
    }
}
