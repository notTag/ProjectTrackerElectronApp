/**
 * Builds the Warp launch configuration that carries a ticket's command into a
 * new Warp tab. Warp takes no argv through `open -a`, but it runs the commands
 * in a launch configuration opened via `warp://launch/<name>`.
 *
 * Kept separate from main.ts — which cannot be imported under test because it
 * touches the Electron app object at module load — so the escaping below has a
 * home that tests can reach.
 */

export const WARP_LAUNCH_CONFIG_NAME = 'project-tracker-ticket'

// JSON's string syntax is a subset of a YAML double-quoted scalar, so this
// carries the newlines and quotes of a ticket prompt through intact without
// pulling in a YAML serializer for two fields.
const yamlDoubleQuoted = (value: string) => JSON.stringify(value)

export const warpLaunchConfigYaml = (projectPath: string, command: string): string =>
  [
    '---',
    `name: ${WARP_LAUNCH_CONFIG_NAME}`,
    'windows:',
    '  - tabs:',
    '      - layout:',
    `          cwd: ${yamlDoubleQuoted(projectPath)}`,
    '          commands:',
    `            - exec: ${yamlDoubleQuoted(command)}`,
    ''
  ].join('\n')
