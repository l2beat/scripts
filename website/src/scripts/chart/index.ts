import { getOutputs } from './getOutputs'
import { plot } from './plot'
import { ChartStateWithInput, makeChartState } from './state'
import { toUiState, UiState } from './ui'

export function initChart(chart: HTMLElement) {
  const outputs = getOutputs(chart)

  let uiState: UiState | undefined
  const chartState = makeChartState(chart, () => update())
  window.addEventListener('resize', () => requestAnimationFrame(draw))

  function update() {
    uiState = chartState.input && toUiState(chartState as ChartStateWithInput)
    requestAnimationFrame(draw)
  }

  function draw() {
    plot(uiState, outputs)
  }
}