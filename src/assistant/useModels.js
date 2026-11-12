import {useCallback,useEffect,useRef,useState} from 'react';
import {request} from '../api';
import {assistantError} from './modelState.mjs';
export function useModels(ai){
  const [catalog,setCatalog]=useState(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const generation=useRef(0),savingRef=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const refresh=useCallback(async()=>{
    if(savingRef.current)return;
    const gen=++generation.current;setLoading(true);
    try{const next=await request('/models');if(mounted.current&&gen===generation.current){setCatalog(next);setError('');}}
    catch(e){if(mounted.current&&gen===generation.current)setError(assistantError(e));}
    finally{if(mounted.current&&gen===generation.current)setLoading(false);}
  },[]);
  useEffect(()=>{refresh();},[refresh,ai.connected,ai.label]);
  useEffect(()=>{window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[refresh]);
  const choose=useCallback(async selection=>{
    if(savingRef.current)return;
    savingRef.current=true;const gen=++generation.current;setSaving(true);setLoading(false);setError('');
    try{const next=await request('/models',{selection});if(mounted.current&&gen===generation.current)setCatalog(next);}
    catch(e){if(mounted.current&&gen===generation.current)setError(assistantError(e));}
    finally{savingRef.current=false;if(mounted.current&&gen===generation.current)setSaving(false);}
  },[]);
  return {catalog,loading:loading||saving,saving,error,refresh,choose};
}
