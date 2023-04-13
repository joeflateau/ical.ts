import Mocha from 'mocha';
const {
  EVENT_RUN_BEGIN,
  EVENT_RUN_END,
  EVENT_TEST_FAIL,
  EVENT_TEST_PASS,
  EVENT_SUITE_BEGIN,
  EVENT_SUITE_END
} = Mocha.Runner.constants;

const { Base } = Mocha.reporters;
const { color } = Base;

// this reporter outputs test results, indenting two spaces per suite
class MyReporter extends Base {
  _indents = 0;
  _n = 0;

  constructor(runner: Mocha.Runner, options?: Mocha.MochaOptions) {
    super(runner, options);

    runner
      .once(EVENT_RUN_BEGIN, () => {
        Base.consoleLog();
      })
      .on(EVENT_SUITE_BEGIN, suite => {
        this._indents++;
        Base.consoleLog(color('suite', '%s%s'), this.indent(), suite.title);
      })
      .on(EVENT_SUITE_END, () => {
        this._indents--;
        if (this._indents === 1) {
          Base.consoleLog();
        }
      })
      .on(EVENT_TEST_PASS, test => {
        // Test#fullTitle() returns the suite name(s)
        // prepended to the test title
        const fmt =
          this.indent() +
          color('checkmark', '  ' + Base.symbols.ok) +
          color('pass', ' %s') +
          ' (fastest: %s)';
        Base.consoleLog(fmt, test.fullTitle(), test._benchFastest.join(','));
        this._indents += 2;
        Base.consoleLog(
          this.indent() + test._benchCycle.join('\n' + this.indent())
        );
        this._indents -= 2;
      })
      .on(EVENT_TEST_FAIL, (test, err) => {
        Base.consoleLog(
          this.indent() + color('fail', '  %d) %s'),
          ++this._n,
          test.title
        );
      })
      .once(EVENT_RUN_END, this.epilogue.bind(this));
  }

  indent() {
    return Array(this._indents).join('  ');
  }

  increaseIndent() {}

  decreaseIndent() {
    this._indents--;
  }
}

module.exports = MyReporter;
