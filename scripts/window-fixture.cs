using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using System.Runtime.InteropServices;
class VerificationFixture {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [STAThread] static void Main(string[] args) {
    // Match the native broker's physical-pixel coordinates on scaled desktops.
    if(!SetProcessDpiAwarenessContext(new IntPtr(-4))) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    Application.EnableVisualStyles();
    using (var form = new Form { Text="Window Use MCP verification", AccessibleName="Window Use MCP verification", StartPosition=FormStartPosition.Manual, Location=new Point(80,80), Size=new Size(540,330) }) {
      var edit = new TextBox { Name="verificationInput", AccessibleName="Verification input", Location=new Point(25,35), Size=new Size(450,30), Text="before" };
      var button = new Button { Name="verificationButton", AccessibleName="Apply verification", Text="Apply verification", Location=new Point(25,85), Size=new Size(180,40) };
      var label = new Label { AccessibleName="Verification result", Text="not applied", Location=new Point(25,150), Size=new Size(450,50) };
      int clickCount=0;
      if(args.Length>0)File.WriteAllText(args[0]+".clicks","0");
      button.Click += (sender,e) => { label.Text="Applied: "+edit.Text; label.AccessibleName=label.Text; clickCount++; if(args.Length>0)File.WriteAllText(args[0]+".clicks",clickCount.ToString()); };
      form.Controls.AddRange(new Control[]{edit,button,label});
      int keyPresses=0;
      Action writeState=()=>{if(args.Length>0)File.WriteAllText(args[0]+".state","{\"keyPresses\":"+keyPresses+",\"length\":"+edit.Text.Length+",\"expected\":"+(edit.Text=="Window Use verified"?"true":"false")+"}");};
      edit.KeyPress += (sender,e)=>{keyPresses++;writeState();};
      edit.TextChanged += (sender,e)=>writeState();
      var activationTimer = new Timer { Interval=100 };
      activationTimer.Tick += (sender,e) => {
        if(args.Length>0 && File.Exists(args[0]+".activate")) {
          form.TopMost=true; form.Activate(); form.BringToFront();
          if(GetForegroundWindow()==form.Handle) { File.Delete(args[0]+".activate"); File.WriteAllText(args[0]+".active","true"); }
        }
      };
      activationTimer.Start();
      form.Shown += (sender,e) => { if(args.Length>0) { var p=button.PointToScreen(new Point(70,20)); var q=edit.PointToScreen(new Point(40,10)); File.WriteAllText(args[0],"{\"buttonX\":"+p.X+",\"buttonY\":"+p.Y+",\"editX\":"+q.X+",\"editY\":"+q.Y+"}"); } };
      Application.Run(form);
      activationTimer.Dispose();
    }
  }
}
