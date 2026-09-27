import XCTest
@testable import PulsoDoDia

@MainActor
final class DashboardViewModelTests: XCTestCase {
    func testRefreshLoadsSummary() async {
        let model = DashboardViewModel(service: MockHealthService(delay: .zero))
        await model.start()
        XCTAssertEqual(model.summary?.steps, 8_432)
        XCTAssertNotNil(model.lastUpdated)
        XCTAssertFalse(model.showPermissionHint)
        XCTAssertEqual(model.stepProgress ?? 0, 8_432 / AppConfig.dailyStepGoal, accuracy: 0.001)
    }

    func testEmptySummaryShowsPermissionHint() async {
        let model = DashboardViewModel(service: MockHealthService(summary: .empty(), delay: .zero))
        await model.refresh()
        XCTAssertTrue(model.showPermissionHint)
        XCTAssertNil(model.stepProgress)
    }

    func testStepProgressIsCappedAtOne() async {
        var summary = DailySummary.empty()
        summary.steps = 20_000
        let model = DashboardViewModel(service: MockHealthService(summary: summary, delay: .zero))
        await model.refresh()
        XCTAssertEqual(model.stepProgress, 1)
    }
}

final class FormatTests: XCTestCase {
    func testDuration() {
        XCTAssertEqual(Format.duration(27_120), "7h 32min")
        XCTAssertEqual(Format.duration(2_700), "45min")
        XCTAssertEqual(Format.duration(7_200), "2h")
    }

    func testIntegerUsesBrazilianGrouping() {
        XCTAssertEqual(Format.integer(8_432.4), "8.432")
    }
}
