/**
 * A real DuckDuckGo HTML result page, and a builder for the shapes a real one
 * does not conveniently contain.
 *
 * `MEASURED_RESULT_PAGE` is the actual response of
 * `GET https://html.duckduckgo.com/html/?q=響け！ユーフォニアム Chinese name 中文名`,
 * captured 2026-09-04 and trimmed to its first three results with the wrapper
 * markup around them left as it was. It is here so the parser is tested against
 * somebody else's real output — including the `<b>` highlighting and the
 * `&#x27;` / `&quot;` escaping that output carries — rather than against a
 * tidied idea of it.
 *
 * `makeResultPage` builds the variants that page happens not to show: a result
 * with no snippet, and a link behind DuckDuckGo's own `/l/?uddg=` redirector.
 */

/** One result as the HTML endpoint renders it. */
export interface ResultMarkup {
  href: string;
  title: string;
  /** Omitted entirely when this result has no snippet anchor at all. */
  snippet?: string;
}

/** The two anchors of one result, in the order and nesting DuckDuckGo emits. */
function resultBlock(result: ResultMarkup): string {
  const snippet =
    result.snippet === undefined
      ? ""
      : `\n<a class="result__snippet" href="${result.href}">${result.snippet}</a>`;
  return `<div class="result results_links results_links_deep web-result">
<h2 class="result__title">
<a rel="nofollow" class="result__a" href="${result.href}">${result.title}</a>
</h2>${snippet}
</div>`;
}

/** A results page carrying exactly these results. */
export function makeResultPage(results: readonly ResultMarkup[]): string {
  return `<html><body><div id="links" class="results">\n${results.map(resultBlock).join("\n")}\n</div></body></html>`;
}

/** The measured page: three results, the first two on Wikipedia. */
export const MEASURED_RESULT_PAGE = `<div id="links" class="results">
            <div class="result results_links results_links_deep web-result ">
              <div class="links_main links_deep result__body"> <!-- This is the visible part -->
                <h2 class="result__title">
                  <a rel="nofollow" class="result__a" href="https://zh.wikipedia.org/zh-cn/%E5%90%B9%E9%9F%BF%E5%90%A7%EF%BC%81%E4%B8%8A%E4%BD%8E%E9%9F%B3%E8%99%9F">吹响吧!上低音号 - 维基百科，自由的百科全书</a>
                </h2>
                <div class="result__extras">
                  <div class="result__extras__url"><a class="result__url" href="https://zh.wikipedia.org/zh-cn/%E5%90%B9%E9%9F%BF%E5%90%A7%EF%BC%81%E4%B8%8A%E4%BD%8E%E9%9F%B3%E8%99%9F">https://zh.wikipedia.org/zh-cn/%E5%90%B9%E9%9F%BF%E5%90%A7%EF%BC%81%E4%B8%8A%E4%BD%8E%E9%9F%B3%E8%99%9F</a></div>
                </div>
                <a class="result__snippet" href="https://zh.wikipedia.org/zh-cn/%E5%90%B9%E9%9F%BF%E5%90%A7%EF%BC%81%E4%B8%8A%E4%BD%8E%E9%9F%B3%E8%99%9F">^ テレビアニメ化が決定した『響け! ユーフォニアム』2015年4月放送予定と明らかに! アニメーション制作は、京都アニメーションが担当 [决定改编电视动画的&#x27;吹响吧! 上低音号&#x27;判明预定于2015年4月放送! 动画制作由京都动画担当].</a>
                <div class="clear"></div>
              </div>
            </div>
            <div class="result results_links results_links_deep web-result ">
              <div class="links_main links_deep result__body"> <!-- This is the visible part -->
                <h2 class="result__title">
                  <a rel="nofollow" class="result__a" href="https://zh.wikipedia.org/zh-hk/%E5%90%B9%E9%9F%BF%E5%90%A7%EF%BC%81%E4%B8%8A%E4%BD%8E%E9%9F%B3%E8%99%9F">吹響吧!上低音號 - 維基百科，自由的百科全書</a>
                </h2>
                <div class="result__extras">
                  <div class="result__extras__url"><a class="result__url" href="https://zh.wikipedia.org/zh-hk/%E5%90%B9%E9%9F%BF%E5%90%A7%EF%BC%81%E4%B8%8A%E4%BD%8E%E9%9F%B3%E8%99%9F">https://zh.wikipedia.org/zh-hk/%E5%90%B9%E9%9F%BF%E5%90%A7%EF%BC%81%E4%B8%8A%E4%BD%8E%E9%9F%B3%E8%99%9F</a></div>
                </div>
                <a class="result__snippet" href="https://zh.wikipedia.org/zh-hk/%E5%90%B9%E9%9F%BF%E5%90%A7%EF%BC%81%E4%B8%8A%E4%BD%8E%E9%9F%B3%E8%99%9F">《吹響吧!上低音號》 （日語：響け!ユーフォニアム） 是 武田綾乃 創作的日本 小說 系列作品，插畫為 淺田妮姬。</a>
                <div class="clear"></div>
              </div>
            </div>
            <div class="result results_links results_links_deep web-result ">
              <div class="links_main links_deep result__body"> <!-- This is the visible part -->
                <h2 class="result__title">
                  <a rel="nofollow" class="result__a" href="https://bangumi.pro/subject/115908">番组计划 (伪) - bangumi.pro</a>
                </h2>
                <div class="result__extras">
                  <div class="result__extras__url"><a class="result__url" href="https://bangumi.pro/subject/115908">https://bangumi.pro/subject/115908</a></div>
                </div>
                <a class="result__snippet" href="https://bangumi.pro/subject/115908">片尾曲 トゥッティ! 广播剧 「響け! ユーフォニアム」 TVアニメ <b>響け!</b> <b>ユーフォニアム</b> ドラマCD 其他 &quot;Sound! Euphonium&quot; Best Theme Songs Collection</a>
                <div class="clear"></div>
              </div>
            </div>
</div>`;
