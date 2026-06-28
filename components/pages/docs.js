document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('doc-list');
  
  try {
    const response = await fetch('../docs/register.json');
    const register = await response.json();
    
    list.innerHTML = '';
    
    for (const [key, filename] of Object.entries(register)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `../docs/${filename}`;
      a.textContent = key;
      li.appendChild(a);
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = '<li style="color:red">Error loading documents</li>';
    console.error(err);
  }
});