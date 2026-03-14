import memoryContextPlugin from '../../src/index';

describe('memory-context command and HTTP registration', () => {
  it('should register /memorycontext command and plugin HTTP route', async () => {
    const registerCommand = jest.fn();
    const registerHttpRoute = jest.fn();
    const registerGatewayMethod = jest.fn();
    const registerTool = jest.fn();
    const on = jest.fn();

    memoryContextPlugin.register({
      pluginConfig: {},
      registerCommand,
      registerHttpRoute,
      registerGatewayMethod,
      registerTool,
      on,
      runtime: { tools: { registerMemoryCli: jest.fn() } },
      registerCli: jest.fn(),
    } as any);

    expect(registerCommand).toHaveBeenCalledWith(expect.objectContaining({ name: 'memorycontext' }));
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/plugins/memory-context/view', auth: 'plugin', match: 'exact' })
    );
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/plugins/memory-context', auth: 'plugin', match: 'prefix' })
    );
  });
});
