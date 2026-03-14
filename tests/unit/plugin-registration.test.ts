import memoryContextPlugin from '../../src/index';

describe('memory-context plugin registration', () => {
  it('should register gateway methods, tools, command, and prompt hook', () => {
    const registerGatewayMethod = jest.fn();
    const registerTool = jest.fn();
    const registerCommand = jest.fn();
    const on = jest.fn();
    const registerCli = jest.fn();

    memoryContextPlugin.register({
      pluginConfig: {},
      registerGatewayMethod,
      registerTool,
      registerCommand,
      registerCli,
      on,
      runtime: {
        tools: {
          registerMemoryCli: jest.fn(),
        },
      },
    } as any);

    expect(registerGatewayMethod).toHaveBeenCalled();
    expect(registerTool).toHaveBeenCalled();
    expect(registerCommand).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'memorycontext' })
    );
    expect(on).toHaveBeenCalledWith(
      'before_prompt_build',
      expect.any(Function)
    );
  });
});
